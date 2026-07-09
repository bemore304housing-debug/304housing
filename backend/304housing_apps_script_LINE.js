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
    }

    // ── 2. Form data (multipart / x-www-form-urlencoded) ──────
    const data = e.parameter || {};

    if (data.action === "uploadImage") return uploadImage(data);
    if (data.action === "approve")     return approveSubmission(Number(data.row), data.property_code || "");
    if (data.action === "reject")      return rejectSubmission(Number(data.row), data.reason || "");
    if (data.action === "save_customer_lead") return saveCustomerLead(data);

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
  pushLine(userId, [
    {
      type: "flex",
      altText: "ยินดีต้อนรับสู่ 304 Housing by Be More! 🏠",
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
            { type: "text", text: "ยินดีต้อนรับครับ! 👋", weight: "bold", size: "lg" },
            { type: "text", text: "เราช่วยหาบ้านเช่าคุณภาพดีรอบนิคมอุตสาหกรรม 304 จ.ปราจีนบุรี", wrap: true, color: "#555555", size: "sm" },
            { type: "separator", margin: "md" },
            {
              type: "box", layout: "vertical", spacing: "sm",
              contents: [
                bulletText("🏠 ฝากทรัพย์ — ลงประกาศบ้านเช่าฟรี"),
                bulletText("📝 ลงทะเบียนสนใจเช่า — แจ้งทำเล/งบประมาณ"),
                bulletText("📅 นัดชม — จองเวลาดูบ้านสะดวก"),
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
              action: { type: "uri", label: "🏠 ฝากทรัพย์เลย", uri: INTAKE_FORM_URL }
            },
            {
              type: "button", style: "primary", color: "#1e4620",
              action: { type: "uri", label: "📝 ลงทะเบียนสนใจเช่า", uri: buildCustomerRegisterUri(userId) }
            }
          ]
        }
      }
    }
  ]);
}

// ── Unfollow: บันทึกลง Sheet ──────────────────────────────
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

  // ── Default: แนะนำเมนู ──
  pushLine(userId, [{
    type: "text",
    text: "สวัสดีครับ! พิมพ์คำสั่งเหล่านี้ได้เลยครับ:\n\n🏠 ฝากทรัพย์\n📝 ลงทะเบียนเช่า\n📅 นัดชม\n💰 ราคา\n📞 ติดต่อ"
  }]);
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
}


// ═════════════════════════════════════════════════════════════
//  FLEX MESSAGE TEMPLATES
// ═════════════════════════════════════════════════════════════

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
          action: { type: "uri", label: "ดูรายการทรัพย์ →", uri: INTAKE_FORM_URL.replace("intake-form", "customer-search") }
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
  replyLine(null, []); // ไม่ใช้ reply ตรงนี้
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
  };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
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

const CUSTOMER_HEADERS = ["timestamp","lineUserId","fullName","phoneNumber","email","foreignSocial","lineId","targetLocation","budgetRange","rentalDuration","moveInMonth","preferredLanguage","saveSearch","status"];

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
      status              : "ใหม่",
    };

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
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
      const headers = ctSheet.getRange(1, 1, 1, 8).getValues()[0];
      const rows    = ctSheet.getRange(2, 1, ctSheet.getLastRow() - 1, 8).getValues();
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

  const subHeaders = ["timestamp","status","property_code","property_type","project_name","address_no","moo","sub_district","district","distance_km","map_url","bedrooms","bathrooms","land_size","area_size","parking","appliances_list","furniture_list","rent_price","accept_foreigner","owner_name","owner_phone","shuttle_bus","pets_allowed","notes","image_url"];
  const subSheet = getOrCreateSheet(ss, "submissions");
  subSheet.getRange(1, 1, 1, subHeaders.length).setValues([subHeaders]).setFontWeight("bold").setBackground("#1e4620").setFontColor("#ffffff");

  const propHeaders = ["property_code","property_type","status","rent_price","distance_km","project_name","map_url","shuttle_bus","accept_foreigner","pets_allowed","bedrooms","bathrooms","land_size","area_size","address_display","appliances_list","furniture_list","image_url","owner_name","sub_district","district"];
  const propSheet = getOrCreateSheet(ss, "properties");
  propSheet.getRange(1, 1, 1, propHeaders.length).setValues([propHeaders]).setFontWeight("bold").setBackground("#1a5276").setFontColor("#ffffff");

  const ctHeaders = ["contract_code","property_code","tenant_name","start_date","expiry_date","rent_amount","status","notes"];
  const ctSheet = getOrCreateSheet(ss, "contracts");
  ctSheet.getRange(1, 1, 1, ctHeaders.length).setValues([ctHeaders]).setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");

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
  const subHeaders = ["timestamp","status","property_code","property_type","project_name","address_no","moo","sub_district","district","distance_km","map_url","bedrooms","bathrooms","land_size","area_size","parking","appliances_list","furniture_list","rent_price","accept_foreigner","owner_name","owner_phone","shuttle_bus","pets_allowed","notes","image_url"];
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
