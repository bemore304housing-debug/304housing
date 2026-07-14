/**
 * 304 Housing by Be More — Google Apps Script (Prototype 2 + LINE OA)
 * Sheet ID : 1Rkc2vALQWZIhSMnXd2A0Fbv7n6rdeMpYnBDpFtDGltY
 *
 * ══════════════════════════════════════════════════════════════════
 *  ก่อน Deploy ต้องตั้งค่า Script Properties ก่อน (สำคัญมาก!)
 *  Apps Script Editor → Project Settings → Script Properties → Add
 *
 *  LINE_CHANNEL_ACCESS_TOKEN  =  <Long-lived channel access token>
 *  LINE_CHANNEL_SECRET        =  <Channel secret>
 *
 *  ทั้งสองค่าอยู่ใน LINE Developers Console
 *  → เลือก Channel → Basic settings / Messaging API
 * ══════════════════════════════════════════════════════════════════
 *
 *  Deploy Steps:
 *   1. วางโค้ดนี้ใน Apps Script Editor
 *   2. ตั้งค่า Script Properties ด้านบน
 *   3. Run → testAuth() ครั้งแรกเพื่อ authorize
 *   4. Deploy → New deployment
 *      Execute as : Me
 *      Who has access : Anyone
 *   5. Copy URL ใหม่ไปใส่ใน LINE Developers → Webhook URL
 *   6. กด Verify → ควรขึ้น Success
 */

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────
const SHEET_ID = "1Rkc2vALQWZIhSMnXd2A0Fbv7n6rdeMpYnBDpFtDGltY";

function LINE_TOKEN()  { return PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN"); }
function LINE_SECRET() { return PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_SECRET"); }

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL  = "https://api.line.me/v2/bot/message/push";

// LIFF URL ของฟอร์มฝากทรัพย์ (เปลี่ยนเป็น URL จริงหลัง deploy)
const INTAKE_FORM_URL = "https://bemore304housing-debug.github.io/304housing/intake-form.html";

// URL ฟอร์มลงทะเบียนผู้สนใจเช่า (ฝั่งผู้เช่า — Agency ติดต่อกลับเพื่อนัดชม)
const CUSTOMER_REGISTER_URL = "https://bemore304housing-debug.github.io/304housing/customer-register.html";

// ชื่อโฟลเดอร์ Google Drive สำหรับเก็บรูปทรัพย์
// Script จะสร้างโฟลเดอร์นี้ใน Drive ของ account ที่รัน Script อัตโนมัติ
const DRIVE_FOLDER_NAME = "304Housing-Photos";

// พิกัดอ้างอิง: สวนอุตสาหกรรม 304 (สำนักงานขาย) ต.ท่าตูม อ.ศรีมหาโพธิ จ.ปราจีนบุรี
// ใช้คำนวณระยะทาง (กม.) จากพิกัด GPS ที่ผู้ฝากทรัพย์ปักหมุดในฟอร์ม
const REF_LAT = 13.9149096;
const REF_LNG = 101.5721673;


// ─────────────────────────────────────────────────────────────
//  TEST AUTH (รันครั้งแรกเพื่อ authorize)
// ─────────────────────────────────────────────────────────────
function testAuth() {
  // 1. Test Spreadsheet
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Logger.log("✅ Sheet: " + ss.getName());
  Logger.log("📋 Tabs: " + ss.getSheets().map(s => s.getName()).join(", "));

  // 2. Test LINE Token
  Logger.log("🔑 LINE Token set: " + (LINE_TOKEN() ? "YES" : "NO — ต้องตั้งค่า Script Properties!"));

  // 3. Test Google Drive (สำคัญ: ต้องรันเพื่อ authorize Drive scope)
  const folder = getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
  Logger.log("📁 Drive folder: " + folder.getName() + " | ID: " + folder.getId());
  Logger.log("🔗 URL: https://drive.google.com/drive/folders/" + folder.getId());
  Logger.log("✅ Drive authorization สำเร็จ — อัปโหลดรูปได้แล้ว");
}

function testToken() {
  const token = LINE_TOKEN();
  Logger.log("Token length: " + token.length);
  Logger.log("Token prefix: " + token.substring(0, 30) + "...");

  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
    headers: { "Authorization": "Bearer " + token },
    muteHttpExceptions: true
  });
  Logger.log("Status: " + res.getResponseCode());
  Logger.log("Response: " + res.getContentText());
}

function testReply() {
  const YOUR_USER_ID = "Uaa660dc1dcd943147360ebff49528479";

  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_TOKEN()
    },
    payload: JSON.stringify({
      to: YOUR_USER_ID,
      messages: [{ type: "text", text: "🧪 ทดสอบ Push จาก Apps Script ✅" }]
    }),
    muteHttpExceptions: true
  });

  Logger.log("Status: " + res.getResponseCode());
  Logger.log("Response: " + res.getContentText());
}

function testFlexCard() {
  const userId = "Uaa660dc1dcd943147360ebff49528479";

  const res = UrlFetchApp.fetch(LINE_PUSH_URL, {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_TOKEN()
    },
    payload: JSON.stringify({
      to: userId,
      messages: [flexIntakeCard()]
    }),
    muteHttpExceptions: true
  });

  Logger.log("Status: " + res.getResponseCode());
  Logger.log("Response: " + res.getContentText());
}


// ─────────────────────────────────────────────────────────────
//  doPost — รับทุก POST request (LINE Webhook + Form + Admin)
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    // ── 1. ตรวจว่าเป็น LINE Webhook ──────────────────────────
    if (e.postData && e.postData.type === "application/json") {
      const body = JSON.parse(e.postData.contents);

      if (typeof body.events !== "undefined") {
        // LINE webhook — ต้องตอบ 200 ก่อนเสมอ แล้วค่อย process
        handleLineEvents(body.events);
        return ContentService
          .createTextOutput(JSON.stringify({ status: "ok" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // JSON อื่น (เช่น action จาก admin dashboard)
      const data = body;
      if (data.action === "approve") return approveSubmission(Number(data.row), data.property_code || "");
      if (data.action === "reject")  return rejectSubmission(Number(data.row), data.reason || "");
      if (data.action === "save_customer_lead") return saveCustomerLead(data);
      if (data.action === "save_contract") return saveContract(data);
    }

    // ── 2. Form data (multipart / x-www-form-urlencoded) ──────
    const data = e.parameter || {};

    if (data.action === "uploadImage") return uploadImage(data);
    if (data.action === "approve")     return approveSubmission(Number(data.row), data.property_code || "");
    if (data.action === "reject")      return rejectSubmission(Number(data.row), data.reason || "");
    if (data.action === "save_customer_lead") return saveCustomerLead(data);
    if (data.action === "save_contract") return saveContract(data);

    // ── 3. บันทึก Intake Form ──────────────────────────────────
    return saveSubmission(data);

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}


// ─────────────────────────────────────────────────────────────
//  doGet — รับ GET requests (getProperties, getDashboard, ฯลฯ)
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "getProperties";
  const handlers = {
    getProperties : getProperties,
    getDashboard  : getDashboard,
    getSubmissions: getSubmissions,
    getImage      : getImage,
    test          : testEndpoint,
  };
  const fn = handlers[action];
  if (!fn) return jsonResponse({ status: "error", message: "Unknown action: " + action });
  return fn(e);
}


// ═════════════════════════════════════════════════════════════
//  LINE EVENT HANDLERS
// ═════════════════════════════════════════════════════════════

function handleLineEvents(events) {
  events.forEach(event => {
    try {
      switch (event.type) {
        case "follow":    handleFollow(event);   break;
        case "unfollow":  handleUnfollow(event); break;
        case "message":   handleMessage(event);  break;
        case "postback":  handlePostback(event); break;
      }
    } catch (err) {
      Logger.log("LINE event error: " + err.toString());
    }
  });
}

// ── Follow: ส่งข้อความต้อนรับ ──────────────────────────────
function handleFollow(event) {
  const userId = event.source && event.source.userId;
  pushLine(userId, [flexMainMenu(userId)]);
}

function handleUnfollow(event) {
  const userId = event.source && event.source.userId;
  Logger.log("Unfollow: " + userId);
  // สามารถบันทึกลง analytics sheet ได้ในอนาคต
}

// ── Message: ตอบตามคีย์เวิร์ด ──────────────────────────────
function handleMessage(event) {
  if (event.message.type !== "text") return;
  const userId = event.source && event.source.userId;
  const text = event.message.text.trim().toLowerCase();

  // ── ฝากทรัพย์ ──
  if (matchKeyword(text, ["ฝากทรัพย์", "ลงประกาศ", "ฝากบ้าน", "ลงทรัพย์", "register", "property"])) {
    pushLine(userId, [flexIntakeCard()]);
    return;
  }

  // ── ลงทะเบียนสนใจเช่า (ฝั่งผู้เช่า — Agency ติดต่อกลับเพื่อนัดชม/ทำสัญญา) ──
  if (matchKeyword(text, ["ลงทะเบียนเช่า", "สนใจเช่า", "อยากเช่า", "ต้องการเช่า", "แจ้งความประสงค์เช่า"])) {
    pushLine(userId, [flexCustomerRegisterCard(userId)]);
    return;
  }

  // ── ค้นหาบ้าน (ยังไม่เปิดใช้ Phase นี้ — คงคีย์เวิร์ดเดิมไว้เผื่ออนาคต) ──
  if (matchKeyword(text, ["ค้นหาบ้าน", "หาบ้าน", "ดูบ้าน", "เช่าบ้าน", "search", "find"])) {
    pushLine(userId, [flexSearchCard()]);
    return;
  }

  // ── นัดชม ──
  if (matchKeyword(text, ["นัดชม", "ดูบ้าน", "จองเวลา", "appointment", "viewing"])) {
    pushLine(userId, [{
      type: "text",
      text: "📅 ระบบนัดชมจะเปิดให้บริการเร็วๆ นี้ครับ\n\nสำหรับตอนนี้ติดต่อทีมงานได้ที่:\n📞 โทร/LINE: 08X-XXX-XXXX"
    }]);
    return;
  }

  // ── ราคา / ค่าเช่า ──
  if (matchKeyword(text, ["ราคา", "ค่าเช่า", "price", "rent"])) {
    pushLine(userId, [flexPriceInfo()]);
    return;
  }

  // ── ติดต่อ ──
  if (matchKeyword(text, ["ติดต่อ", "โทร", "contact", "call"])) {
    pushLine(userId, [{
      type: "text",
      text: "📞 ติดต่อทีมงาน 304 Housing\n\n📱 LINE: @304housingbybemore\n☎️ โทร: 08X-XXX-XXXX\n⏰ เปิดทำการ: จ-ศ 8:00–18:00"
    }]);
    return;
  }

  // ── ถอนความยินยอม (PDPA มาตรา 19) ──
  if (matchKeyword(text, ["ถอนความยินยอม", "ยกเลิกความยินยอม", "ลบข้อมูลของฉัน", "withdraw consent", "withdraw"])) {
    pushLine(userId, [flexWithdrawConsentConfirm()]);
    return;
  }

  // ── Default: แสดงเมนูหลัก ──
  pushLine(userId, [flexMainMenu(userId)]);
}



// ── Postback: ปุ่ม Rich Menu / Flex ──────────────────────────
function handlePostback(event) {
  const data = event.postback && event.postback.data;
  const userId = event.source && event.source.userId;
  if (!data) return;

  if (data === "action=intake")  { pushLine(userId, [flexIntakeCard()]);  return; }
  if (data === "action=customer_register") { pushLine(userId, [flexCustomerRegisterCard(userId)]); return; }
  if (data === "action=search")  { pushLine(userId, [flexSearchCard()]);  return; }
  if (data === "action=contact") {
    pushLine(userId, [{
      type: "text", text: "📞 ติดต่อทีมงาน\n📱 LINE: @304housingbybemore\n☎️ 08X-XXX-XXXX"
    }]);
    return;
  }
  if (data === "action=withdraw_consent_confirm") { withdrawConsent(userId); return; }
  if (data === "action=withdraw_consent_cancel") {
    pushLine(userId, [{ type: "text", text: "ยกเลิกคำขอแล้วครับ ข้อมูลของท่านยังคงถูกเก็บและใช้งานตามปกติ 🙏" }]);
    return;
  }
}


// ═════════════════════════════════════════════════════════════
//  FLEX MESSAGE TEMPLATES
// ═════════════════════════════════════════════════════════════

function flexMainMenu(userId) {
  return {
    type: "flex",
    altText: "เมนูหลัก 304 Housing by Be More",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical",
        backgroundColor: "#1e4620",
        contents: [
          { type: "text", text: "🏠 304 Housing by Be More", color: "#ffffff", weight: "bold", size: "md" },
          { type: "text", text: "บริการหาบ้านเช่ารอบนิคม 304", color: "#bbf7d0", size: "sm", margin: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "ยินดีต้อนรับครับ 👋", weight: "bold", size: "lg" },
          { type: "text", text: "กรุณาเลือกว่าท่านเป็นฝ่ายใดครับ", wrap: true, color: "#555555", size: "sm" },
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "vertical", spacing: "sm",
            contents: [
              bulletText("🏠 เจ้าของบ้าน — ฝากบ้านให้เช่าฟรี"),
              bulletText("🔍 ผู้เช่า — ลงทะเบียนหาบ้านเช่า"),
              bulletText("🌐 รองรับ 4 ภาษา TH/EN/ZH/JA"),
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          {
            type: "button", style: "primary", color: "#1e4620",
            action: { type: "uri", label: "เจ้าของบ้านฝากบ้านให้เช่า", uri: INTAKE_FORM_URL }
          },
          {
            type: "button", style: "primary", color: "#1e4620",
            action: { type: "uri", label: "ผู้เช่าหาบ้านเช่า", uri: buildCustomerRegisterUri(userId) }
          }
        ]
      }
    }
  };
}

function flexIntakeCard() {
  return {
    type: "flex",
    altText: "ฝากทรัพย์กับ 304 Housing",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1e4620",
        contents: [
          { type: "text", text: "📋 ฟอร์มฝากทรัพย์", color: "#ffffff", weight: "bold", size: "lg" },
          { type: "text", text: "304 Housing by Be More", color: "#bbf7d0", size: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "กรอกข้อมูลทรัพย์ผ่านแบบฟอร์มออนไลน์", wrap: true, color: "#555555", size: "sm" },
          { type: "text", text: "ใช้เวลาประมาณ 3–5 นาที ไม่มีค่าใช้จ่าย", wrap: true, color: "#888888", size: "xs" },
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "vertical", spacing: "xs",
            contents: [
              bulletText("📸 อัปโหลดรูปได้สูงสุด 6 ภาพ"),
              bulletText("✅ ทีมงานตรวจสอบภายใน 24 ชม."),
              bulletText("🌐 รองรับเจ้าของชาวต่างชาติ"),
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [{
          type: "button", style: "primary", color: "#1e4620",
          action: { type: "uri", label: "เปิดฟอร์มฝากทรัพย์ →", uri: INTAKE_FORM_URL }
        }]
      }
    }
  };
}

// ฟอร์มลงทะเบียนผู้สนใจเช่า — Agency เป็นตัวกลางติดต่อเจ้าของ/นัดชม/ทำสัญญา
// ผู้เช่าไม่ติดต่อเจ้าของทรัพย์โดยตรง
function flexCustomerRegisterCard(userId) {
  return {
    type: "flex",
    altText: "ลงทะเบียนสนใจเช่าที่พัก",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1e4620",
        contents: [
          { type: "text", text: "📝 ลงทะเบียนสนใจเช่า", color: "#ffffff", weight: "bold", size: "lg" },
          { type: "text", text: "304 Housing by Be More", color: "#bbf7d0", size: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "แจ้งทำเลและงบประมาณที่ต้องการ ทีมงานจะติดต่อกลับเพื่อนัดหมายดูทรัพย์ที่ตรงใจ", wrap: true, color: "#555555", size: "sm" },
          { type: "text", text: "ใช้เวลาประมาณ 1 นาที ไม่มีค่าใช้จ่าย", wrap: true, color: "#888888", size: "xs" },
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "vertical", spacing: "xs",
            contents: [
              bulletText("📋 กรอกทำเล งบประมาณ และช่องทางติดต่อ"),
              bulletText("📞 ทีมงานติดต่อกลับเพื่อนัดชมทรัพย์"),
              bulletText("🤝 ดูแลตั้งแต่นัดชมจนถึงทำสัญญาเช่า"),
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [{
          type: "button", style: "primary", color: "#1e4620",
          action: { type: "uri", label: "ลงทะเบียนเลย →", uri: buildCustomerRegisterUri(userId) }
        }]
      }
    }
  };
}

function flexSearchCard() {
  // ดึงจำนวนทรัพย์จริงจาก Sheet
  let count = 0;
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("properties");
    if (sheet && sheet.getLastRow() > 1) {
      const statuses = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues();
      count = statuses.filter(r => r[0] === "เผยแพร่").length;
    }
  } catch(_) {}

  return {
    type: "flex",
    altText: "ค้นหาบ้านเช่ารอบนิคม 304",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1e4620",
        contents: [
          { type: "text", text: "🔍 ค้นหาบ้านเช่า", color: "#ffffff", weight: "bold", size: "lg" },
          { type: "text", text: "รอบนิคม 304 จ.ปราจีนบุรี", color: "#bbf7d0", size: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          {
            type: "box", layout: "horizontal",
            contents: [
              { type: "text", text: "ทรัพย์พร้อมเช่า", color: "#555555", size: "sm", flex: 3 },
              { type: "text", text: count + " รายการ", color: "#1e4620", size: "sm", weight: "bold", align: "end", flex: 2 }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "vertical", spacing: "xs",
            contents: [
              bulletText("🏠 ทาวน์โฮม / บ้านเดี่ยว / คอนโด"),
              bulletText("🚌 กรองทรัพย์ที่รถรับส่งผ่าน"),
              bulletText("🌐 รองรับ 4 ภาษา TH/EN/ZH/JA"),
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [{
          type: "button", style: "primary", color: "#1e4620",
          action: { type: "uri", label: "ดูรายการทรัพย์ →", uri: INTAKE_FORM_URL.replace("intake-form", "property-search") }
        }]
      }
    }
  };
}

function flexPriceInfo() {
  return {
    type: "flex",
    altText: "ราคาค่าเช่ารอบนิคม 304",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "💰 ราคาค่าเช่ารอบนิคม 304", weight: "bold", size: "md" },
          { type: "separator" },
          priceRow("ห้องเช่า / คอนโด",  "4,000 – 8,000"),
          priceRow("ทาวน์โฮม (2 นอน)",   "8,000 – 12,000"),
          priceRow("ทาวน์โฮม (3 นอน)",  "12,000 – 18,000"),
          priceRow("บ้านเดี่ยว",          "15,000 – 30,000"),
          { type: "separator" },
          { type: "text", text: "* ราคาเป็นค่าประมาณ ขึ้นกับระยะทางและสิ่งอำนวยความสะดวก", wrap: true, size: "xs", color: "#aaaaaa" }
        ]
      }
    }
  };
}

function flexWithdrawConsentConfirm() {
  return {
    type: "flex",
    altText: "ยืนยันการถอนความยินยอม (PDPA)",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#B91C1C",
        contents: [
          { type: "text", text: "⚠️ ถอนความยินยอม (PDPA)", color: "#ffffff", weight: "bold", size: "md" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "ท่านต้องการถอนความยินยอมการเก็บ ใช้ และเปิดเผยข้อมูลส่วนบุคคลของท่านใช่หรือไม่?", wrap: true, size: "sm" },
          { type: "text", text: "หากยืนยัน ทีมงานจะหยุดจับคู่ทรัพย์สินและติดต่อท่านเพื่อวัตถุประสงค์ทางการตลาด โดยข้อมูลที่บันทึกไว้ก่อนหน้าจะถูกทำเครื่องหมายว่าถอนความยินยอมแล้ว", wrap: true, size: "xs", color: "#888888" }
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          {
            type: "button", style: "primary", color: "#B91C1C",
            action: { type: "postback", label: "ยืนยันถอนความยินยอม", data: "action=withdraw_consent_confirm" }
          },
          {
            type: "button", style: "secondary",
            action: { type: "postback", label: "ยกเลิก", data: "action=withdraw_consent_cancel" }
          }
        ]
      }
    }
  };
}


// ═════════════════════════════════════════════════════════════
//  LINE API — Reply & Push
// ═════════════════════════════════════════════════════════════

function replyLine(replyToken, messages) {
  if (!replyToken || !LINE_TOKEN()) return;
  UrlFetchApp.fetch(LINE_REPLY_URL, {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_TOKEN()
    },
    payload: JSON.stringify({ replyToken, messages }),
    muteHttpExceptions: true
  });
}

function pushLine(userId, messages) {
  if (!userId || !LINE_TOKEN()) return;
  UrlFetchApp.fetch(LINE_PUSH_URL, {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_TOKEN()
    },
    payload: JSON.stringify({ to: userId, messages }),
    muteHttpExceptions: true
  });
}

// Push แจ้ง Admin Group เมื่อมีทรัพย์ใหม่
// (ต้อง set ADMIN_GROUP_ID ใน Script Properties)
function notifyAdminNewSubmission(data, rowNum) {
  const groupId = PropertiesService.getScriptProperties().getProperty("ADMIN_LINE_GROUP_ID");
  if (!groupId || !LINE_TOKEN()) return;

  const msg = [
    "🆕 ทรัพย์ใหม่เข้าคลัง!",
    "",
    "📋 แถวที่: " + rowNum,
    "🏠 ประเภท: " + (data.property_type || "-"),
    "📍 " + [data.sub_district, data.district].filter(Boolean).join(", ") + (data.map_url ? " | 🗺️ " + data.map_url : ""),
    "💰 " + Number(data.rent_price || 0).toLocaleString() + " บ./ด.",
    (data.shuttle_bus === "ผ่าน" ? "🚌 รถรับส่งผ่าน" : ""),
    (data.accept_foreigner === "ยินยอม" ? "🌐 รับต่างชาติ" : ""),
    "",
    "👤 " + (data.owner_name || "-"),
    "📞 " + (data.owner_phone || "-"),
    "",
    "➡️ ตรวจสอบและอนุมัติใน Admin Dashboard"
  ].filter(l => l !== undefined).join("\n");

  pushLine(groupId, [{ type: "text", text: msg }]);
}

// Push แจ้ง Admin Group เมื่อมีลูกค้าลงทะเบียนสนใจเช่าใหม่
// (Agency เป็นตัวกลาง — ติดต่อลูกค้ากลับเพื่อนัดชมทรัพย์ ไม่ให้ผู้เช่าติดต่อเจ้าของตรง)
function notifyAdminNewLead(data, rowNum) {
  const groupId = PropertiesService.getScriptProperties().getProperty("ADMIN_LINE_GROUP_ID");
  if (!groupId || !LINE_TOKEN()) return;

  const msg = [
    "🙋 ลูกค้าสนใจเช่าลงทะเบียนใหม่!",
    "",
    "📋 แถวที่: " + rowNum,
    "👤 " + (data.fullName || "-"),
    "📞 " + (data.phoneNumber || "-"),
    (data.email ? "✉️ " + data.email : ""),
    (data.lineId ? "💬 LINE ID: " + data.lineId : ""),
    (data.lineUserId ? "🔗 เชื่อมต่อผ่าน LINE bot แล้ว (ทักกลับได้ทันที)" : ""),
    "📍 ทำเล: " + (data.targetLocation || "ไม่ระบุ"),
    "💰 งบประมาณ: " + (data.budgetRange || "ไม่ระบุ"),
    "📅 ระยะเวลาเช่า: " + (data.rentalDuration || "ไม่ระบุ"),
    "🚚 ต้องการย้ายเข้าเดือน: " + (data.moveInMonth || "ไม่ระบุ"),
    "🌐 ภาษา: " + (data.preferredLanguage || "-"),
    "",
    "➡️ ติดต่อลูกค้าเพื่อนัดหมายดูทรัพย์"
  ].filter(l => l !== undefined && l !== "").join("\n");

  pushLine(groupId, [{ type: "text", text: msg }]);
}

// Push แจ้งเจ้าของ LINE เมื่ออนุมัติทรัพย์
function notifyOwnerApproved(ownerUserId, propertyCode, propertyType) {
  if (!ownerUserId || !LINE_TOKEN()) return;
  pushLine(ownerUserId, [{
    type: "flex",
    altText: "ทรัพย์ของคุณได้รับการอนุมัติแล้ว! 🎉",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1e4620",
        contents: [
          { type: "text", text: "✅ อนุมัติแล้ว!", color: "#ffffff", weight: "bold", size: "xl" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "ทรัพย์ของคุณได้รับการอนุมัติและเผยแพร่แล้วครับ! 🎉", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "รหัสทรัพย์: " + propertyCode, weight: "bold", color: "#1e4620" },
          { type: "text", text: "ประเภท: " + propertyType, size: "sm", color: "#555555" },
          { type: "text", text: "ทรัพย์ของคุณจะปรากฏในหน้าค้นหาให้ลูกค้าเห็นทันที", wrap: true, size: "sm", color: "#888888", margin: "md" }
        ]
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [{
          type: "button", style: "secondary",
          action: { type: "message", label: "🔍 ดูทรัพย์ของฉัน", text: "ค้นหาบ้าน" }
        }]
      }
    }
  }]);
}


// ═════════════════════════════════════════════════════════════
//  FORM SUBMISSION
// ═════════════════════════════════════════════════════════════

function saveSubmission(data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateSheet(ss, "submissions");

  if (sheet.getLastRow() === 0) setupSheets();

  // คำนวณระยะทางจากพิกัด GPS (ถ้าฟอร์มส่ง lat/lng มา) เผื่อ client ไม่ได้คำนวณเอง
  let distanceKm = data.distance_km || "";
  if (!distanceKm && data.lat && data.lng) {
    distanceKm = haversineKm(Number(data.lat), Number(data.lng), REF_LAT, REF_LNG).toFixed(1);
  }

  // เขียนข้อมูลตามชื่อ header จริงของ sheet (ไม่ hardcode ตำแหน่ง คอลัมน์)
  // ป้องกันข้อมูลเพี้ยนหาก column ของ sheet ถูกเรียงสลับ/เพิ่ม/ลดในอนาคต
  const fieldMap = {
    timestamp        : new Date(),
    status           : "รอคัดกรอง",
    property_code    : "",
    property_type    : data.property_type    || "",
    project_name     : data.project_name     || "",
    address_no       : data.address_no       || "",
    moo              : data.moo              || "",
    sub_district     : data.sub_district     || "",
    district         : data.district         || "",
    distance_km      : distanceKm,
    map_url          : data.map_url          || "",
    bedrooms         : data.bedrooms         || 0,
    bathrooms        : data.bathrooms        || 0,
    land_size        : data.land_size        || "",
    area_size        : data.area_size        || "",
    parking          : data.parking          || "",
    appliances_list  : data.appliances_list  || "ไม่มี",
    furniture_list   : data.furniture_list   || "ไม่มี",
    rent_price       : data.rent_price       || "",
    accept_foreigner : data.accept_foreigner || "ไม่ระบุ",
    owner_name       : data.owner_name       || "",
    owner_phone      : data.owner_phone      || "",
    shuttle_bus      : data.shuttle_bus      || "",
    pets_allowed     : data.pets_allowed     || "",
    notes            : data.notes            || "",
    image_url        : data.image_url        || "",
    consentGiven: data.consentGiven || "",
    consentTimestamp: data.consentTimestamp || "",
    consentPolicyVersion: data.consentPolicyVersion || "",
  };

  // ป้องกันข้อมูลหาย: เติม header คอลัมน์ที่ขาดต่อท้ายอัตโนมัติ (เหมือน saveCustomerLead)
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const REQUIRED_SUB_HEADERS = ["consentGiven","consentTimestamp","consentPolicyVersion"];
  const missingSubHeaders = REQUIRED_SUB_HEADERS.filter(h => headers.indexOf(h) === -1);
  if (missingSubHeaders.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, missingSubHeaders.length).setValues([missingSubHeaders])
      .setFontWeight("bold").setBackground("#1e4620").setFontColor("#ffffff");
    headers = headers.concat(missingSubHeaders);
  }
  const row = headers.map(h => fieldMap.hasOwnProperty(h) ? fieldMap[h] : "");
  sheet.appendRow(row);

  const lastRow = sheet.getLastRow();
  const statusCol = headers.indexOf("status") + 1;
  if (statusCol > 0) sheet.getRange(lastRow, statusCol).setBackground("#FEF3C7");

  // แจ้ง Admin LINE Group
  notifyAdminNewSubmission(data, lastRow);

  return jsonResponse({ status: "success", message: "บันทึกข้อมูลเรียบร้อย", row: lastRow });
}


// ═════════════════════════════════════════════════════════════
//  CUSTOMER LEAD (ผู้สนใจเช่า) — Agency ติดต่อกลับเพื่อนัดชม/ทำสัญญา
// ═════════════════════════════════════════════════════════════

const CUSTOMER_HEADERS = ["timestamp","lineUserId","fullName","phoneNumber","email","foreignSocial","lineId","targetLocation","budgetRange","rentalDuration","moveInMonth","preferredLanguage","saveSearch","consentGiven","consentTimestamp","consentPolicyVersion","status","assignedTo"];

function saveCustomerLead(data) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, "customers");

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, CUSTOMER_HEADERS.length).setValues([CUSTOMER_HEADERS])
        .setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");
    }

    const fieldMap = {
      timestamp          : new Date(),
      lineUserId          : data.lineUserId          || "",
      fullName            : data.fullName            || "",
      phoneNumber         : data.phoneNumber         || "",
      email               : data.email               || "",
      foreignSocial       : data.foreignSocial       || "",
      lineId              : data.lineId              || "",
      targetLocation      : data.targetLocation      || "",
      budgetRange         : data.budgetRange         || "",
      rentalDuration      : data.rentalDuration      || "",
      moveInMonth         : data.moveInMonth         || "",
      preferredLanguage   : data.preferredLanguage   || "",
      saveSearch          : data.saveSearch          || "",
      consentGiven        : data.consentGiven || "",
      consentTimestamp    : data.consentTimestamp || "",
      consentPolicyVersion: data.consentPolicyVersion || "",
      status              : "ใหม่",
    };

    // ป้องกันข้อมูลหาย: ถ้าชีตเดิมมีอยู่แล้วก่อนเพิ่ม field ใหม่ (header แถวแรกไม่ครบ)
    // ให้เติม header คอลัมน์ที่ขาดต่อท้ายอัตโนมัติ แทนที่จะทิ้งข้อมูลนั้นไปเงียบๆ
    let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const missingHeaders = CUSTOMER_HEADERS.filter(h => headers.indexOf(h) === -1);
    if (missingHeaders.length > 0) {
      sheet.getRange(1, headers.length + 1, 1, missingHeaders.length).setValues([missingHeaders])
        .setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");
      headers = headers.concat(missingHeaders);
    }

    const row = headers.map(h => fieldMap.hasOwnProperty(h) ? fieldMap[h] : "");
    sheet.appendRow(row);

    const lastRow = sheet.getLastRow();
    const statusCol = headers.indexOf("status") + 1;
    if (statusCol > 0) sheet.getRange(lastRow, statusCol).setBackground("#EDE9FE");

    // แจ้ง Admin LINE Group ให้ทีมงานติดต่อกลับ (Agency เป็นตัวกลาง)
    notifyAdminNewLead(fieldMap, lastRow);

    return jsonResponse({ status: "success", message: "ลงทะเบียนเรียบร้อย ทีมงานจะติดต่อกลับโดยเร็วที่สุดครับ", row: lastRow });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// ── ถอนความยินยอม (PDPA มาตรา 19) — ผู้ใช้ยกเลิกความยินยอมผ่าน LINE OA ──
function withdrawConsent(userId) {
  if (!userId) return;
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, "customers");
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      pushLine(userId, [{ type: "text", text: "ไม่พบข้อมูลของท่านในระบบครับ หากท่านเคยลงทะเบียนด้วยช่องทางอื่น กรุณาติดต่อทีมงานโดยตรง" }]);
      return;
    }

    let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const EXTRA_HEADERS = ["consentWithdrawn", "consentWithdrawnTimestamp"];
    const missingHeaders = EXTRA_HEADERS.filter(h => headers.indexOf(h) === -1);
    if (missingHeaders.length > 0) {
      sheet.getRange(1, headers.length + 1, 1, missingHeaders.length).setValues([missingHeaders])
        .setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");
      headers = headers.concat(missingHeaders);
    }

    const lineUserIdCol  = headers.indexOf("lineUserId") + 1;
    const statusCol      = headers.indexOf("status") + 1;
    const withdrawnCol   = headers.indexOf("consentWithdrawn") + 1;
    const withdrawnTsCol = headers.indexOf("consentWithdrawnTimestamp") + 1;
    if (lineUserIdCol === 0) return;

    const dataRange = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const now = new Date();
    let matched = 0;

    dataRange.forEach((row, i) => {
      if (row[lineUserIdCol - 1] === userId) {
        matched++;
        const r = i + 2;
        if (statusCol > 0)      sheet.getRange(r, statusCol).setValue("ถอนความยินยอม").setBackground("#FECACA");
        if (withdrawnCol > 0)   sheet.getRange(r, withdrawnCol).setValue(true);
        if (withdrawnTsCol > 0) sheet.getRange(r, withdrawnTsCol).setValue(now);
      }
    });

    if (matched === 0) {
      pushLine(userId, [{ type: "text", text: "ไม่พบข้อมูลของท่านในระบบครับ หากท่านเคยลงทะเบียนด้วยช่องทางอื่น กรุณาติดต่อทีมงานโดยตรง" }]);
      return;
    }

    pushLine(userId, [{
      type: "text",
      text: "✅ รับทราบการถอนความยินยอมแล้วครับ\n\nทีมงานจะหยุดจับคู่ทรัพย์สินและติดต่อท่านเพื่อวัตถุประสงค์ทางการตลาด ตั้งแต่บัดนี้เป็นต้นไป\n\nหากต้องการลงทะเบียนใหม่ในอนาคต สามารถทักแชทนี้ได้ทุกเมื่อครับ 🙏"
    }]);

    notifyAdminConsentWithdrawn(userId, matched);

  } catch (err) {
    Logger.log("withdrawConsent error: " + err.toString());
  }
}

// แจ้ง Admin Group เมื่อมีผู้ถอนความยินยอม (PDPA มาตรา 19)
function notifyAdminConsentWithdrawn(userId, rowCount) {
  const groupId = PropertiesService.getScriptProperties().getProperty("ADMIN_LINE_GROUP_ID");
  if (!groupId || !LINE_TOKEN()) return;
  pushLine(groupId, [{
    type: "text",
    text: "⚠️ มีลูกค้าถอนความยินยอม (PDPA มาตรา 19)\n\n🔗 LINE User ID: " + userId + "\n📋 จำนวนแถวที่อัปเดต: " + rowCount + "\n\n➡️ กรุณาหยุดติดต่อ/จับคู่ทรัพย์สินให้ลูกค้ารายนี้"
  }]);
}

// ═════════════════════════════════════════════════════════════
//  CONTRACT (สัญญาเช่า + คอมมิชชั่น) — Admin กรอกหลังปิดดีล
// ═════════════════════════════════════════════════════════════

const CONTRACT_HEADERS = ["contract_code","property_code","tenant_name","tenant_phone","tenant_id_number","tenant_nationality","tenant_address","owner_name","owner_phone","owner_address","start_date","expiry_date","rent_amount","payment_due_day","security_deposit","advance_rent","commission_rate","commission_amount","commission_status","commission_paid_date","bank_name","bank_branch","bank_account_number","bank_account_name","witness_name","status","notes","createdAt","createdBy"];

function saveContract(data) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateSheet(ss, "contracts");

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, CONTRACT_HEADERS.length).setValues([CONTRACT_HEADERS])
        .setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");
    }

    const fieldMap = {
      contract_code        : data.contract_code        || "",
      property_code        : data.property_code        || "",
      tenant_name           : data.tenant_name           || "",
      tenant_phone          : data.tenant_phone          || "",
      tenant_id_number      : data.tenant_id_number      || "",
      tenant_nationality    : data.tenant_nationality    || "",
      tenant_address        : data.tenant_address        || "",
      owner_name             : data.owner_name             || "",
      owner_phone            : data.owner_phone            || "",
      owner_address          : data.owner_address          || "",
      start_date             : data.start_date             || "",
      expiry_date            : data.expiry_date            || "",
      rent_amount            : data.rent_amount            || "",
      payment_due_day        : data.payment_due_day        || "",
      security_deposit       : data.security_deposit       || "",
      advance_rent           : data.advance_rent           || "",
      commission_rate        : data.commission_rate        || "",
      commission_amount      : data.commission_amount      || "",
      commission_status      : data.commission_status      || "ยังไม่จ่าย",
      commission_paid_date   : data.commission_paid_date   || "",
      bank_name              : data.bank_name              || "",
      bank_branch            : data.bank_branch            || "",
      bank_account_number    : data.bank_account_number    || "",
      bank_account_name      : data.bank_account_name      || "",
      witness_name           : data.witness_name           || "",
      status                 : data.status                 || "ใช้งานอยู่",
      notes                  : data.notes                  || "",
      createdAt               : new Date(),
      createdBy               : data.createdBy               || "",
    };

    // ป้องกันข้อมูลหาย: เติม header คอลัมน์ที่ขาดต่อท้ายอัตโนมัติ (เหมือน saveCustomerLead)
    let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const missingHeaders = CONTRACT_HEADERS.filter(h => headers.indexOf(h) === -1);
    if (missingHeaders.length > 0) {
      sheet.getRange(1, headers.length + 1, 1, missingHeaders.length).setValues([missingHeaders])
        .setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");
      headers = headers.concat(missingHeaders);
    }

    const row = headers.map(h => fieldMap.hasOwnProperty(h) ? fieldMap[h] : "");
    sheet.appendRow(row);

    const lastRow = sheet.getLastRow();

    notifyAdminNewContract(fieldMap, lastRow);

    let pdfUrls = {};
    try {
      pdfUrls = generateContractPDFs_(fieldMap);
    } catch (pdfErr) {
      pdfUrls = { error: pdfErr.toString() };
    }

    return jsonResponse({ status: "success", message: "บันทึกสัญญาเรียบร้อย", row: lastRow, pdfUrls: pdfUrls });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// แจ้ง Admin Group เมื่อมีการบันทึกสัญญาใหม่ (เช็คงานคอมมิชชั่น)
function notifyAdminNewContract(data, rowNum) {
  const groupId = PropertiesService.getScriptProperties().getProperty("ADMIN_LINE_GROUP_ID");
  if (!groupId || !LINE_TOKEN()) return;

  const msg = [
    "📄 บันทึกสัญญาเช่าใหม่!",
    "",
    "📋 แถวที่: " + rowNum,
    "🔖 รหัสสัญญา: " + (data.contract_code || "-"),
    "🏠 รหัสทรัพย์: " + (data.property_code || "-"),
    "👤 ผู้เช่า: " + (data.tenant_name || "-"),
    "📅 " + (data.start_date || "-") + " ถึง " + (data.expiry_date || "-"),
    "💰 ค่าเช่า: " + (data.rent_amount || "-") + " บาท/เดือน",
    "💵 คอมมิชชั่น: " + (data.commission_amount || "-") + " บาท (" + (data.commission_status || "ยังไม่จ่าย") + ")",
  ].join("\n");

  pushLine(groupId, [{ type: "text", text: msg }]);
}

// ═════════════════════════════════════════════════════════════
//  PDF สัญญา — auto-generate จาก template ใน Google Drive
//  (ตั้งค่าครั้งเดียว: อัปโหลด .docx 3 ไฟล์ -> Save as Google Docs -> ใส่ Doc ID ด้านล่าง)
// ═════════════════════════════════════════════════════════════

const CONTRACT_TEMPLATE_IDS = {
  commission: "1MMsEGkQq0hz4I0_NwiKd19_cFqbIwMcEdCngjuYBYuo",
  lease_tp:   "1xvjkvFaPoAeouo0a8ZVQSYptoMIQMfh4_eIE6Cm24Bo",
  proud:      "1JDPTqsiKmVdwpp5gD4v12bw8jkwlfS7bbg7UqKzYJa0",
};

function escRe_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReplacements_(docId, pairs) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const report = [];
  pairs.forEach(function (p) {
    const pattern = p[2] === true ? p[0] : escRe_(p[0]);
    const before = body.getText();
    const matches = (before.match(new RegExp(pattern, "g")) || []).length;
    body.replaceText(pattern, p[1]);
    report.push(pattern.substring(0, 40) + " -> matches:" + matches);
  });
  doc.saveAndClose();
  return report;
}

// ตั้งค่าครั้งเดียว: ใส่ {{merge_tag}} ใน template ทั้ง 3 ฉบับ (รันครั้งเดียวหลังอัปโหลด template ใหม่)
function tagContractTemplates() {
  const out = {};

  // ---------- DOC 1: สัญญาคอมมิชชั่น ----------
  out.commission = applyReplacements_(CONTRACT_TEMPLATE_IDS.commission, [
    ["เมื่อวันที่ 25 พฤษภาคม พ.ศ. XXXX", "เมื่อวันที่ {{sign_date}}"],
    ["นางสาว X+", "{{createdBy}}", true],
    ["นายXXXX XXXX", "{{owner_name}}"],
    ["โครงการ THE PROUD ทาวน์โฮม 304-โรจนะ เลขที่ 456/151 หมู่ 9 ตำบลหนองโพรง อำเภอศรีมหาโพธิ จังหวัดปราจีนบุรี 25140",
     "โครงการ {{property_project_name}} เลขที่ {{property_address}}"],
    ["ตั้งแต่วันที่ 05/07/2025 ถึงวันที่ 04/07/2026", "ตั้งแต่วันที่ {{start_date}} ถึงวันที่ {{expiry_date}}"],
    ["อัตราค่าเช่าเดือนละ 32,000 บาท", "อัตราค่าเช่าเดือนละ {{rent_amount}} บาท"],
    ["ในอัตราค่าเช่า 1 หรือ 0.5 เดือน เป็นจำนวนเงินสุทธิ 32,000 บาท (สามหมื่นสองพันบาทถ้วน)",
     "ในอัตราค่าเช่า {{commission_rate}} เป็นจำนวนเงินสุทธิ {{commission_amount}} บาท"],
  ]);

  // ---------- DOC 2: สัญญาเช่าบ้าน_TP ----------
  out.lease_tp = applyReplacements_(CONTRACT_TEMPLATE_IDS.lease_tp, [
    ["หน้าเลขที่ TP2022041", "หน้าเลขที่ {{contract_code}}"],
    ["ชื่อ-สกุลเจ้าของบ้าน", "{{owner_name}}"],
    ["โทรศัพท์ xxxxxxxxxxxxxxxxxx", "โทรศัพท์ {{owner_phone}}"],
    ["ต่อไปนี้ในสัญญานี้เรียกว่า \"ผู้ให้เช่า\" ฝ่ายหนึ่ง",
     "ต่อไปนี้ในสัญญานี้เรียกว่า \"ผู้ให้เช่า\" ฝ่ายหนึ่ง (ที่อยู่: {{owner_address}})"],
    ["กับ MR.QIU YAHAN อยู่บ้านเลขที่", "กับ {{tenant_name}} อยู่บ้านเลขที่ {{tenant_address}}"],
    ["ซึ่งต่อไปนี้ในสัญญานี้เรียกว่า \"ผู้เช่า\" อีกฝ่ายหนึ่ง",
     "ซึ่งต่อไปนี้ในสัญญานี้เรียกว่า \"ผู้เช่า\" อีกฝ่ายหนึ่ง (โทร: {{tenant_phone}})"],
    ["081-715-2448", "{{tenant_phone}}"],
    ["456/102", "{{property_address}}"],
    ["22.8", "{{property_land_size}}"],
    ["เดอะ พราวด์", "{{property_project_name}}"],
    ["อัตรา 7,000บาท", "อัตรา {{rent_amount}} บาท"],
    ["(เจ็ดพันบาทถ้วน)", ""],
    ["ชำระภายในวันที่ _ 30__ ของแต่ละเดือน", "ชำระภายในวันที่ {{payment_due_day}} ของแต่ละเดือน"],
    ["21,000.-", "{{security_deposit}}"],
    ["(สองหมื่นหนึ่งพันบาทถ้วน)", ""],
    ["เริ่มต้นในวันที่", "เริ่มต้นในวันที่ {{start_date}} ("],
    ["สิ้นสุดในวันที่  _27 ธันวาคม 2567", "สิ้นสุดในวันที่ {{expiry_date}}"],
    ["MR.QIU YAHAN", "{{tenant_name}}"],
  ]);

  // ---------- DOC 3: The Proud Town Home (MOU+Receipt+Lease) ----------
  out.proud = applyReplacements_(CONTRACT_TEMPLATE_IDS.proud, [
    ["456/151 หมู่ 9 ตำบลหนองโพรง อำเภอศรีมหาโพธิ จังหวัดปราจีนบุรี 25140", "{{property_address}}"],
    ["THE PROUD ทาวน์โฮม 304-โรจนะ", "{{property_project_name}}"],
    ["นายพิเชฐ จวนรุ่ง", "{{owner_name}}"],
    ["นางสาวปรีดาภรณ์ โสนอ่อน", "{{tenant_name}}"],
    ["นายนฤนาถ ช่วยชู", "{{createdBy}}"],
    ["(Thirty two thousand Baht only)", ""],
    ["(Sixty-four thousand Baht only)", ""],
    ["(Ninety-six thousand baht. Baht Only)", ""],
    ["96,000", "{{total_received}}"],
    ["32,000", "{{rent_amount}}"],
    ["64,000", "{{security_deposit}}"],
    ["05/07/2025", "{{start_date}}"],
    ["04/07/2026", "{{expiry_date}}"],
    ["04/07/2025", "{{sign_date}}"],
    ["เลขทะเบียนนิติบุคคล XXXXXXXXX สัญชาติ ไทย", "เลขทะเบียนนิติบุคคล {{tenant_id_number}} สัญชาติ {{tenant_nationality}}"],
    ["อยู่ที่ XXX  ซ.XXX  XXXXXXXXXXXXXXXXXXX", "อยู่ที่ {{tenant_address}}"],
    ["Miss XXXX  residing at XX  Soi XXX , Khlong Bang Bon Subdistrict, Bang Bon District, Bangkok.",
     "Miss {{tenant_name}} residing at {{tenant_address}}."],
    ["And Mr. XXXXX  residing at XXX/XXX  Ratchadaphisek Road, Huai Khwang District, Huai Khwang District, Bangkok.",
     "And Mr. {{owner_name}} residing at {{owner_address}}."],
    ["ธนาคาร กรุงเทพ", "{{bank_name}}"],
    ["สาขา :  XXXXX", "สาขา : {{bank_branch}}"],
    ["Branch:, XXXXX", "Branch: {{bank_branch}}"],
    ["หมายเลขบัญชี : 12345+899", "หมายเลขบัญชี : {{bank_account_number}}"],
    ["Account Number: 12345+899", "Account Number: {{bank_account_number}}"],
    ["ชื่อบัญชี : XXXXXXXX", "ชื่อบัญชี : {{bank_account_name}}"],
    ["Account Name:   XXXXXXXX", "Account Name: {{bank_account_name}}"],
  ]);

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// สร้าง PDF สัญญา 3 ฉบับ จาก template ใน Google Drive (เรียกจาก saveContract() อัตโนมัติ)
function generateContractPDFs_(fieldMap) {
  const CONTRACT_FOLDER_ID = "1S-HD0ek-N6wFNex1fWgI0IRr2PszRyRf";

  // ดึงข้อมูลทรัพย์สินจากชีต properties
  let propRow = null, propHeaders = null;
  const propSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("properties");
  if (propSheet) {
    const data = propSheet.getDataRange().getValues();
    propHeaders = data[0];
    const codeCol = propHeaders.indexOf("property_code");
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][codeCol]) === String(fieldMap.property_code)) { propRow = data[i]; break; }
    }
  }
  function propVal(col) {
    if (!propRow || !propHeaders) return "";
    const idx = propHeaders.indexOf(col);
    return idx === -1 ? "" : (propRow[idx] || "");
  }

  const thaiMonths = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const today = new Date();
  const signDateText = today.getDate() + " " + thaiMonths[today.getMonth()] + " " + (today.getFullYear() + 543);

  const deposit = Number(fieldMap.security_deposit) || 0;
  const advance = Number(fieldMap.advance_rent) || 0;
  const totalReceived = deposit + advance;

  let leaseDurationText = "";
  if (fieldMap.start_date && fieldMap.expiry_date) {
    const sd = new Date(fieldMap.start_date);
    const ed = new Date(fieldMap.expiry_date);
    if (!isNaN(sd) && !isNaN(ed)) {
      const months = Math.round((ed - sd) / (1000 * 60 * 60 * 24 * 30));
      leaseDurationText = months + " เดือน";
    }
  }

  const mergeData = {
    contract_code: fieldMap.contract_code || "",
    tenant_name: fieldMap.tenant_name || "",
    tenant_phone: fieldMap.tenant_phone || "",
    tenant_id_number: fieldMap.tenant_id_number || "",
    tenant_nationality: fieldMap.tenant_nationality || "ไทย",
    tenant_address: fieldMap.tenant_address || "",
    owner_name: fieldMap.owner_name || "",
    owner_phone: fieldMap.owner_phone || "",
    owner_address: fieldMap.owner_address || "",
    start_date: fieldMap.start_date || "",
    expiry_date: fieldMap.expiry_date || "",
    sign_date: signDateText,
    rent_amount: fieldMap.rent_amount || "",
    payment_due_day: fieldMap.payment_due_day || "",
    security_deposit: fieldMap.security_deposit || "",
    commission_rate: fieldMap.commission_rate || "",
    commission_amount: fieldMap.commission_amount || "",
    bank_name: fieldMap.bank_name || "",
    bank_branch: fieldMap.bank_branch || "",
    bank_account_number: fieldMap.bank_account_number || "",
    bank_account_name: fieldMap.bank_account_name || "",
    witness_name: fieldMap.witness_name || "",
    createdBy: fieldMap.createdBy || "",
    property_project_name: propVal("project_name"),
    property_address: propVal("address_display"),
    property_land_size: propVal("land_size"),
    total_received: totalReceived ? totalReceived.toLocaleString("en-US") : "",
    lease_duration_text: leaseDurationText,
  };

  const folder = DriveApp.getFolderById(CONTRACT_FOLDER_ID);
  const pdfUrls = {};

  Object.keys(CONTRACT_TEMPLATE_IDS).forEach(function(key) {
    const templateId = CONTRACT_TEMPLATE_IDS[key];
    const copyName = (mergeData.contract_code || "contract") + "_" + key;
    const copyFile = DriveApp.getFileById(templateId).makeCopy(copyName, folder);
    const doc = DocumentApp.openById(copyFile.getId());
    const body = doc.getBody();
    Object.keys(mergeData).forEach(function(tag) {
      const val = String(mergeData[tag]).replace(/\$/g, "$$$$");
      body.replaceText("\\{\\{" + tag + "\\}\\}", val);
    });
    doc.saveAndClose();

    const pdfBlob = copyFile.getAs(MimeType.PDF);
    const pdfFile = folder.createFile(pdfBlob).setName(copyName + ".pdf");
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    copyFile.setTrashed(true);

    pdfUrls[key] = pdfFile.getUrl();
  });

  return pdfUrls;
}


// สร้าง URL ฟอร์มลงทะเบียนผู้เช่า พร้อมแนบ lineUserId (ถ้ามี) เพื่อให้ฟอร์มรู้จักผู้ใช้อัตโนมัติ
function buildCustomerRegisterUri(userId) {
  return userId ? (CUSTOMER_REGISTER_URL + "?lineUserId=" + encodeURIComponent(userId)) : CUSTOMER_REGISTER_URL;
}


// ═════════════════════════════════════════════════════════════
//  APPROVE / REJECT
// ═════════════════════════════════════════════════════════════

function approveSubmission(rowNumber, propertyCode) {
  try {
    const ss       = SpreadsheetApp.openById(SHEET_ID);
    const subSheet = ss.getSheetByName("submissions");
    const propSheet = getOrCreateSheet(ss, "properties");

    const subHeaders = subSheet.getRange(1, 1, 1, subSheet.getLastColumn()).getValues()[0];
    const rowData    = subSheet.getRange(rowNumber, 1, 1, subSheet.getLastColumn()).getValues()[0];
    const obj = {};
    subHeaders.forEach((h, i) => { obj[h] = rowData[i]; });

    const code = propertyCode || ("RT-" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd") + "-" + String(propSheet.getLastRow()).padStart(3, "0"));

    // เขียนข้อมูลตามชื่อ header จริงของ sheet (ไม่ hardcode ตำแหน่งคอลัมน์)
    const propFieldMap = {
      property_code    : code,
      property_type    : obj["property_type"]    || "",
      status           : "เผยแพร่",
      rent_price       : obj["rent_price"]        || "",
      distance_km      : obj["distance_km"]       || "",
      project_name     : obj["project_name"]      || "",
      map_url          : obj["map_url"]           || "",
      shuttle_bus      : obj["shuttle_bus"]        || "",
      accept_foreigner : obj["accept_foreigner"]   || "",
      pets_allowed     : obj["pets_allowed"]       || "",
      bedrooms         : obj["bedrooms"]           || 0,
      bathrooms        : obj["bathrooms"]          || 0,
      land_size        : obj["land_size"]          || "",
      area_size        : obj["area_size"]          || "",
      address_display  : [obj["address_no"], obj["moo"] ? "ม."+obj["moo"] : "", obj["sub_district"] ? "ต."+obj["sub_district"] : "", obj["district"] ? "อ."+obj["district"] : ""].filter(Boolean).join(" "),
      appliances_list  : obj["appliances_list"]    || "",
      furniture_list   : obj["furniture_list"]     || "",
      image_url        : (obj["image_url"] || "").trim(),
      owner_name       : obj["owner_name"]         || "",
      sub_district     : obj["sub_district"]       || "",
      district         : obj["district"]           || "",
    };

    const propHeaders = propSheet.getRange(1, 1, 1, propSheet.getLastColumn()).getValues()[0];
    const row = propHeaders.map(h => propFieldMap.hasOwnProperty(h) ? propFieldMap[h] : "");
    propSheet.appendRow(row);

    const propStatusCol = propHeaders.indexOf("status") + 1;
    if (propStatusCol > 0) propSheet.getRange(propSheet.getLastRow(), propStatusCol).setBackground("#D5F5E3");

    const subStatusCol = subHeaders.indexOf("status") + 1;
    const subCodeCol   = subHeaders.indexOf("property_code") + 1;
    if (subStatusCol > 0) subSheet.getRange(rowNumber, subStatusCol).setValue("อนุมัติแล้ว").setBackground("#D5F5E3");
    if (subCodeCol > 0)   subSheet.getRange(rowNumber, subCodeCol).setValue(code);

    return jsonResponse({ status: "success", message: "อนุมัติสำเร็จ", property_code: code });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function rejectSubmission(rowNumber, reason) {
  try {
    const ss      = SpreadsheetApp.openById(SHEET_ID);
    const subSheet = ss.getSheetByName("submissions");
    const headers  = subSheet.getRange(1, 1, 1, subSheet.getLastColumn()).getValues()[0];
    const statusCol = headers.indexOf("status") + 1;
    const notesCol  = headers.indexOf("notes") + 1;
    if (statusCol > 0) subSheet.getRange(rowNumber, statusCol).setValue("ปฏิเสธ").setBackground("#FADBD8");
    if (reason && notesCol > 0) subSheet.getRange(rowNumber, notesCol).setValue(reason);
    return jsonResponse({ status: "success", message: "ปฏิเสธเรียบร้อย" });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}


// ═════════════════════════════════════════════════════════════
//  GET HANDLERS
// ═════════════════════════════════════════════════════════════

function testEndpoint() {
  return jsonResponse({
    status  : "success",
    message : "304 Housing Apps Script ทำงานปกติ ✅",
    sheet_id: SHEET_ID,
    line_ok : !!LINE_TOKEN(),
    time    : new Date().toString()
  });
}

function getProperties() {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("properties");
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ status: "success", properties: [] });

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

    const properties = rows
      .filter(r => r[0] !== "" && String(r[2]) === "เผยแพร่")
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i]; });
        return {
          id           : obj["property_code"]    || "",
          type         : obj["property_type"]    || "",
          price        : Number(obj["rent_price"])   || 0,
          distance     : Number(obj["distance_km"])  || 0,
          project_name : obj["project_name"]     || "",
          map_url      : obj["map_url"]          || "",
          shuttle      : obj["shuttle_bus"]      || "",
          tm30         : obj["accept_foreigner"] === "ยินยอม",
          pets         : obj["pets_allowed"]     === "ได้",
          bedrooms     : Number(obj["bedrooms"])     || 0,
          bathrooms    : Number(obj["bathrooms"])    || 0,
          land_size    : obj["land_size"]        || "",
          area         : obj["area_size"]        || "",
          address      : obj["address_display"]  || "",
          appliances   : obj["appliances_list"]  || "",
          furniture    : obj["furniture_list"]   || "",
          image_url    : (obj["image_url"] || "").split(",").map(u => convertDriveUrl(u.trim())).filter(Boolean).join(","),
          owner_name   : obj["owner_name"]       || "",
          sub_district : obj["sub_district"]     || "",
          district     : obj["district"]         || "",
        };
      });

    return jsonResponse({ status: "success", properties });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function getDashboard() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);

    let pendingCount = 0;
    const subSheet = ss.getSheetByName("submissions");
    if (subSheet && subSheet.getLastRow() > 1) {
      pendingCount = subSheet.getRange(2, 2, subSheet.getLastRow() - 1, 1).getValues()
        .filter(r => r[0] === "รอคัดกรอง").length;
    }

    let publishedCount = 0;
    const propSheet = ss.getSheetByName("properties");
    if (propSheet && propSheet.getLastRow() > 1) {
      publishedCount = propSheet.getRange(2, 3, propSheet.getLastRow() - 1, 1).getValues()
        .filter(r => r[0] === "เผยแพร่").length;
    }

    let newLeadCount = 0;
    const custSheet = ss.getSheetByName("customers");
    if (custSheet && custSheet.getLastRow() > 1) {
      const custHeaders = custSheet.getRange(1, 1, 1, custSheet.getLastColumn()).getValues()[0];
      const statusCol = custHeaders.indexOf("status") + 1;
      if (statusCol > 0) {
        newLeadCount = custSheet.getRange(2, statusCol, custSheet.getLastRow() - 1, 1).getValues()
          .filter(r => r[0] === "ใหม่").length;
      }
    }

    let expiringCount = 0, expiringList = [];
    const ctSheet = ss.getSheetByName("contracts");
    if (ctSheet && ctSheet.getLastRow() > 1) {
      // ใช้ getLastColumn() แทนการ hardcode จำนวนคอลัมน์ — ของเดิม hardcode ไว้ที่ 8
      // ทำให้หา "expiry_date" (คอลัมน์ที่ 12) ไม่เจอ และฟีเจอร์แจ้งเตือนสัญญาใกล้หมดอายุไม่ทำงานเลย
      const ctLastCol = ctSheet.getLastColumn();
      const headers = ctSheet.getRange(1, 1, 1, ctLastCol).getValues()[0];
      const rows    = ctSheet.getRange(2, 1, ctSheet.getLastRow() - 1, ctLastCol).getValues();
      const now     = new Date();
      const limit   = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      rows.forEach(r => {
        const expiry = new Date(r[headers.indexOf("expiry_date")]);
        if (expiry >= now && expiry <= limit) {
          expiringCount++;
          expiringList.push({
            contract_code: r[headers.indexOf("contract_code")] || "",
            property_code: r[headers.indexOf("property_code")] || "",
            tenant_name  : r[headers.indexOf("tenant_name")]   || "",
            expiry_date  : Utilities.formatDate(expiry, Session.getScriptTimeZone(), "dd/MM/yyyy"),
          });
        }
      });
    }

    return jsonResponse({ status: "success", pending_count: pendingCount, published_count: publishedCount, new_lead_count: newLeadCount, expiring_count: expiringCount, expiring_list: expiringList });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function getSubmissions() {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("submissions");
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ status: "success", submissions: [] });

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const submissions = rows
      .map((r, idx) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i]; });
        obj._row = idx + 2;
        return obj;
      })
      .filter(o => o["status"] === "รอคัดกรอง");

    return jsonResponse({ status: "success", submissions });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}


// ═════════════════════════════════════════════════════════════
//  UPLOAD IMAGE
// ═════════════════════════════════════════════════════════════

function uploadImage(data) {
  try {
    if (!data.base64 || !data.mimeType) return jsonResponse({ status: "error", message: "Missing base64 or mimeType" });
    const folder   = getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
    const decoded  = Utilities.base64Decode(data.base64);
    const filename = data.filename || ("photo_" + Date.now() + ".jpg");
    const blob     = Utilities.newBlob(decoded, data.mimeType, filename);
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // ใช้ thumbnail URL — แสดงผลใน browser ได้ดีกว่า uc?export=view
    const viewUrl = "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w800";
    return jsonResponse({ status: "success", url: viewUrl, fileId: file.getId() });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}


// ═════════════════════════════════════════════════════════════
//  SHEET SETUP
// ═════════════════════════════════════════════════════════════

function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const subHeaders = ["timestamp","status","property_code","property_type","project_name","address_no","moo","sub_district","district","distance_km","map_url","bedrooms","bathrooms","land_size","area_size","parking","appliances_list","furniture_list","rent_price","accept_foreigner","owner_name","owner_phone","shuttle_bus","pets_allowed","notes","image_url","consentGiven","consentTimestamp","consentPolicyVersion"];
  const subSheet = getOrCreateSheet(ss, "submissions");
  subSheet.getRange(1, 1, 1, subHeaders.length).setValues([subHeaders]).setFontWeight("bold").setBackground("#1e4620").setFontColor("#ffffff");

  const propHeaders = ["property_code","property_type","status","rent_price","distance_km","project_name","map_url","shuttle_bus","accept_foreigner","pets_allowed","bedrooms","bathrooms","land_size","area_size","address_display","appliances_list","furniture_list","image_url","owner_name","sub_district","district"];
  const propSheet = getOrCreateSheet(ss, "properties");
  propSheet.getRange(1, 1, 1, propHeaders.length).setValues([propHeaders]).setFontWeight("bold").setBackground("#1a5276").setFontColor("#ffffff");

  // ใช้ CONTRACT_HEADERS (ประกาศไว้ด้านบน) เป็น single source of truth — ของเดิมมี array
  // แยกต่างหากที่ไม่มี owner_address/bank_*/witness_name ทำให้ schema เพี้ยนไปจากที่ saveContract() ใช้จริง
  const ctSheet = getOrCreateSheet(ss, "contracts");
  ctSheet.getRange(1, 1, 1, CONTRACT_HEADERS.length).setValues([CONTRACT_HEADERS]).setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");

  const custSheet = getOrCreateSheet(ss, "customers");
  custSheet.getRange(1, 1, 1, CUSTOMER_HEADERS.length).setValues([CUSTOMER_HEADERS]).setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");

  Logger.log("✅ setupSheets() เสร็จสมบูรณ์");
}


// ═════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}


// ═════════════════════════════════════════════════════════════
//  ONE-TIME MIGRATION (2026-07-08) — รันครั้งเดียวจาก Editor → Run
//  แก้ปัญหา column เพี้ยน: ล้างข้อมูลทดสอบเก่า, ตั้ง header ใหม่
//  (คืน distance_km + เพิ่ม project_name/map_url/ฯลฯ), กู้แถวทดสอบ
//  ล่าสุด RT-260708-004 กลับมาให้ตรง column
//  ⚠️ ห้ามรันซ้ำหลัง migrate สำเร็จแล้ว — จะหา RT-260708-004 ไม่เจอ
// ═════════════════════════════════════════════════════════════
function migrateSchemaAndData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // ── 1. อ่านแถว submissions เดิม (เขียนด้วยลำดับคอลัมน์ก่อนแก้บั๊ก) ──
  const OLD_SUB_ORDER = ["timestamp","status","property_code","property_type","project_name","address_no","moo","sub_district","district","map_url","bedrooms","bathrooms","land_size","area_size","parking","appliances_list","furniture_list","rent_price","accept_foreigner","owner_name","owner_phone","shuttle_bus","pets_allowed","notes","image_url"];
  const subSheetOld = ss.getSheetByName("submissions");
  const subLastRow  = subSheetOld.getLastRow();
  let savedSubmission = null;
  for (let r = 2; r <= subLastRow; r++) {
    const rowVals = subSheetOld.getRange(r, 1, 1, OLD_SUB_ORDER.length).getValues()[0];
    const obj = {};
    OLD_SUB_ORDER.forEach((h, i) => { obj[h] = rowVals[i]; });
    if (obj.property_code === "RT-260708-004") { savedSubmission = obj; break; }
  }

  // ── 2. ล้าง submissions และตั้ง header ชุดใหม่ ──────────────
  const subHeaders = ["timestamp","status","property_code","property_type","project_name","address_no","moo","sub_district","district","distance_km","map_url","bedrooms","bathrooms","land_size","area_size","parking","appliances_list","furniture_list","rent_price","accept_foreigner","owner_name","owner_phone","shuttle_bus","pets_allowed","notes","image_url","consentGiven","consentTimestamp","consentPolicyVersion"];
  subSheetOld.clear();
  subSheetOld.getRange(1, 1, 1, subHeaders.length).setValues([subHeaders]).setFontWeight("bold").setBackground("#1e4620").setFontColor("#ffffff");

  if (savedSubmission) {
    const row = subHeaders.map(h => savedSubmission.hasOwnProperty(h) ? savedSubmission[h] : "");
    subSheetOld.appendRow(row);
    subSheetOld.getRange(subSheetOld.getLastRow(), subHeaders.indexOf("status") + 1).setBackground("#D5F5E3");
  }

  // ── 3. ล้าง properties และตั้ง header ชุดใหม่ ──────────────
  const propHeaders = ["property_code","property_type","status","rent_price","distance_km","project_name","map_url","shuttle_bus","accept_foreigner","pets_allowed","bedrooms","bathrooms","land_size","area_size","address_display","appliances_list","furniture_list","image_url","owner_name","sub_district","district"];
  const propSheet = ss.getSheetByName("properties");
  propSheet.clear();
  propSheet.getRange(1, 1, 1, propHeaders.length).setValues([propHeaders]).setFontWeight("bold").setBackground("#1a5276").setFontColor("#ffffff");

  // ── 4. สร้างแถว properties ใหม่จากข้อมูล submission ที่กู้มา (แทนแถวเดิมที่เพี้ยน) ──
  if (savedSubmission) {
    const propFieldMap = {
      property_code    : savedSubmission.property_code,
      property_type    : savedSubmission.property_type    || "",
      status           : "เผยแพร่",
      rent_price       : savedSubmission.rent_price        || "",
      distance_km      : "",
      project_name     : savedSubmission.project_name      || "",
      map_url          : savedSubmission.map_url           || "",
      shuttle_bus      : savedSubmission.shuttle_bus        || "",
      accept_foreigner : savedSubmission.accept_foreigner   || "",
      pets_allowed     : savedSubmission.pets_allowed       || "",
      bedrooms         : savedSubmission.bedrooms           || 0,
      bathrooms        : savedSubmission.bathrooms          || 0,
      land_size        : savedSubmission.land_size          || "",
      area_size        : savedSubmission.area_size          || "",
      address_display  : [savedSubmission.address_no, savedSubmission.moo ? "ม." + savedSubmission.moo : "", savedSubmission.sub_district ? "ต." + savedSubmission.sub_district : "", savedSubmission.district ? "อ." + savedSubmission.district : ""].filter(Boolean).join(" "),
      appliances_list  : savedSubmission.appliances_list    || "",
      furniture_list   : savedSubmission.furniture_list     || "",
      image_url        : (savedSubmission.image_url || "").toString().trim(),
      owner_name       : savedSubmission.owner_name         || "",
      sub_district     : savedSubmission.sub_district       || "",
      district         : savedSubmission.district           || "",
    };
    const row2 = propHeaders.map(h => propFieldMap.hasOwnProperty(h) ? propFieldMap[h] : "");
    propSheet.appendRow(row2);
    propSheet.getRange(propSheet.getLastRow(), propHeaders.indexOf("status") + 1).setBackground("#D5F5E3");
  }

  Logger.log("✅ Migration เสร็จสมบูรณ์ — กู้ข้อมูลคืน: " + (savedSubmission ? savedSubmission.property_code : "ไม่พบแถวที่ต้องกู้"));
}

function getOrCreateDriveFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function matchKeyword(text, keywords) {
  return keywords.some(k => text.includes(k.toLowerCase()));
}

// คำนวณระยะทางเส้นตรงระหว่าง 2 พิกัด (กม.) ด้วยสูตร Haversine
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // รัศมีโลก (กม.)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// แปลง Drive URL ทุก format → thumbnail format ที่แสดงใน browser ได้
// ─────────────────────────────────────────────────────────────
//  getImage — proxy รูปจาก Drive ส่งเป็น base64 data URL
//  (แก้ปัญหา auth ที่ browser ต้อง login Google ก่อนดูรูปได้)
// ─────────────────────────────────────────────────────────────
function getImage(e) {
  const fileId = (e && e.parameter && e.parameter.id) ? e.parameter.id : "";
  if (!fileId) return jsonResponse({ status: "error", message: "Missing id" });
  try {
    const file  = DriveApp.getFileById(fileId);
    const blob  = file.getBlob();
    const b64   = Utilities.base64Encode(blob.getBytes());
    const mime  = blob.getContentType() || "image/jpeg";
    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", data: "data:" + mime + ";base64," + b64 }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function convertDriveUrl(url) {
  if (!url) return "";
  // ดึง file ID จาก URL รูปแบบต่างๆ
  const patterns = [
    /[?&]id=([a-zA-Z0-9_-]+)/,          // uc?export=view&id=xxx
    /\/d\/([a-zA-Z0-9_-]+)\//,           // /d/xxx/view
    /\/file\/d\/([a-zA-Z0-9_-]+)/,       // /file/d/xxx
    /thumbnail\?id=([a-zA-Z0-9_-]+)/,    // thumbnail?id=xxx (already correct)
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w800";
  }
  return url; // คืน URL เดิมถ้าแปลงไม่ได้
}

function bulletText(text) {
  return { type: "text", text: text, size: "sm", color: "#444444", wrap: true };
}

function priceRow(label, price) {
  return {
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: "#555555", flex: 3 },
      { type: "text", text: price + " บ./ด.", size: "sm", color: "#1e4620", weight: "bold", align: "end", flex: 2 }
    ]
  };
}


// ═════════════════════════════════════════════════════════════
//  DIAGNOSTIC — one-time debug utilities used while wiring up the
//  contract PDF templates (run manually from the Editor, never
//  invoked by doGet/doPost/triggers). Kept here to mirror the
//  live Apps Script project exactly.
// ═════════════════════════════════════════════════════════════

function diagContractTemplates() {
  const folder = DriveApp.getFolderById("1S-HD0ek-N6wFNex1fWgI0IRr2PszRyRf");
  const removed = [];
  ["E2E-TEST-01_commission", "E2E-TEST-01_lease_tp", "E2E-TEST-01_proud",
   "E2E-TEST-01_commission.pdf", "E2E-TEST-01_lease_tp.pdf", "E2E-TEST-01_proud.pdf"].forEach(function(name){
    const it = folder.getFilesByName(name);
    while (it.hasNext()) { const f = it.next(); f.setTrashed(true); removed.push(name); }
  });
  Logger.log(JSON.stringify(removed));
  return removed;
}


function diagContractTemplates2() {
  function slice(text, anchor, before, after) {
    const i = text.indexOf(anchor);
    if (i === -1) return "ANCHOR_NOT_FOUND: " + anchor;
    return text.substring(Math.max(0, i - before), Math.min(text.length, i + anchor.length + after));
  }
  const l = DocumentApp.openById(CONTRACT_TEMPLATE_IDS.lease_tp).getBody().getText();
  const p = DocumentApp.openById(CONTRACT_TEMPLATE_IDS.proud).getBody().getText();
  const out = {
    lease_owner_ctx: slice(l, "ฝ่ายหนึ่ง", 60, 15),
    lease_tenant_ctx: slice(l, "อีกฝ่ายหนึ่ง", 60, 15),
    proud_tenant_en_ctx: slice(p, "Soi", 60, 100),
    proud_owner_en_full: slice(p, "Ratchadaphisek Road", 60, 90),
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
