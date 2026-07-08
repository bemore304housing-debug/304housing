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

// ชื่อโฟลเดอร์ Google Drive สำหรับเก็บรูปทรัพย์
// Script จะสร้างโฟลเดอร์นี้ใน Drive ของ account ที่รัน Script อัตโนมัติ
const DRIVE_FOLDER_NAME = "304Housing-Photos";


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
    }

    // ── 2. Form data (multipart / x-www-form-urlencoded) ──────
    const data = e.parameter || {};

    if (data.action === "uploadImage") return uploadImage(data);
    if (data.action === "approve")     return approveSubmission(Number(data.row), data.property_code || "");
    if (data.action === "reject")      return rejectSubmission(Number(data.row), data.reason || "");

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
                bulletText("🔍 ค้นหาบ้าน — ดูทรัพย์พร้อมเช่า"),
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
              type: "button", style: "secondary",
              action: { type: "message", label: "🔍 ค้นหาบ้าน", text: "ค้นหาบ้าน" }
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

  // ── ค้นหาบ้าน ──
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
    text: "สวัสดีครับ! พิมพ์คำสั่งเหล่านี้ได้เลยครับ:\n\n🏠 ฝากทรัพย์\n🔍 ค้นหาบ้าน\n📅 นัดชม\n💰 ราคา\n📞 ติดต่อ"
  }]);
}

// ── Postback: ปุ่ม Rich Menu / Flex ──────────────────────────
function handlePostback(event) {
  const data = event.postback && event.postback.data;
  const userId = event.source && event.source.userId;
  if (!data) return;

  if (data === "action=intake")  { pushLine(userId, [flexIntakeCard()]);  return; }
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

  sheet.appendRow([
    new Date(),
    "รอคัดกรอง",
    "",
    data.property_type          || "",
    data.project_name           || "",
    data.address_no             || "",
    data.moo                    || "",
    data.sub_district           || "",
    data.district               || "",
    data.map_url                || "",
    data.bedrooms               || 0,
    data.bathrooms              || 0,
    data.land_size              || "",
    data.area_size              || "",
    data.parking                || "",
    data.appliances_list        || "ไม่มี",
    data.furniture_list         || "ไม่มี",
    data.rent_price             || "",
    data.accept_foreigner       || "ไม่ระบุ",
    data.owner_name             || "",
    data.owner_phone            || "",
    data.shuttle_bus            || "",
    data.pets_allowed           || "",
    data.notes                  || "",
    data.image_url              || "",
  ]);

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 2).setBackground("#FEF3C7");

  // แจ้ง Admin LINE Group
  notifyAdminNewSubmission(data, lastRow);

  return jsonResponse({ status: "success", message: "บันทึกข้อมูลเรียบร้อย", row: lastRow });
}


// ═════════════════════════════════════════════════════════════
//  APPROVE / REJECT
// ═════════════════════════════════════════════════════════════

function approveSubmission(rowNumber, propertyCode) {
  try {
    const ss       = SpreadsheetApp.openById(SHEET_ID);
    const subSheet = ss.getSheetByName("submissions");
    const propSheet = getOrCreateSheet(ss, "properties");

    const subHeaders = subSheet.getRange(1, 1, 1, 25).getValues()[0];
    const rowData    = subSheet.getRange(rowNumber, 1, 1, 25).getValues()[0];
    const obj = {};
    subHeaders.forEach((h, i) => { obj[h] = rowData[i]; });

    const code = propertyCode || ("RT-" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyMMdd") + "-" + String(propSheet.getLastRow()).padStart(3, "0"));

    propSheet.appendRow([
      code,
      obj["property_type"]    || "",
      "เผยแพร่",
      obj["rent_price"]       || "",
      obj["project_name"]     || "",
      obj["map_url"]          || "",
      obj["shuttle_bus"]      || "",
      obj["accept_foreigner"] || "",
      obj["pets_allowed"]     || "",
      obj["bedrooms"]         || 0,
      obj["bathrooms"]        || 0,
      obj["land_size"]        || "",
      obj["area_size"]        || "",
      [obj["address_no"], obj["moo"] ? "ม."+obj["moo"] : "", "ต."+obj["sub_district"], "อ."+obj["district"]].filter(Boolean).join(" "),
      obj["appliances_list"]  || "",
      obj["furniture_list"]   || "",
      (obj["image_url"] || "").trim(),
      obj["owner_name"]       || "",
      obj["sub_district"]     || "",
      obj["district"]         || "",
    ]);

    propSheet.getRange(propSheet.getLastRow(), 3).setBackground("#D5F5E3");
    subSheet.getRange(rowNumber, 2).setValue("อนุมัติแล้ว").setBackground("#D5F5E3");
    subSheet.getRange(rowNumber, 3).setValue(code);

    return jsonResponse({ status: "success", message: "อนุมัติสำเร็จ", property_code: code });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function rejectSubmission(rowNumber, reason) {
  try {
    const ss      = SpreadsheetApp.openById(SHEET_ID);
    const subSheet = ss.getSheetByName("submissions");
    subSheet.getRange(rowNumber, 2).setValue("ปฏิเสธ").setBackground("#FADBD8");
    if (reason) subSheet.getRange(rowNumber, 21).setValue(reason);
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

    const headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, 20).getValues();

    const properties = rows
      .filter(r => r[0] !== "" && String(r[2]) === "เผยแพร่")
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i]; });
        return {
          id           : obj["property_code"]    || "",
          type         : obj["property_type"]    || "",
          price        : Number(obj["rent_price"])   || 0,
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

    return jsonResponse({ status: "success", pending_count: pendingCount, published_count: publishedCount, expiring_count: expiringCount, expiring_list: expiringList });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function getSubmissions() {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("submissions");
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ status: "success", submissions: [] });

    const headers = sheet.getRange(1, 1, 1, 25).getValues()[0];
    const rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, 25).getValues();
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

  const subHeaders = ["timestamp","status","property_code","property_type","project_name","address_no","moo","sub_district","district","map_url","bedrooms","bathrooms","land_size","area_size","parking","appliances_list","furniture_list","rent_price","accept_foreigner","owner_name","owner_phone","shuttle_bus","pets_allowed","notes","image_url"];
  const subSheet = getOrCreateSheet(ss, "submissions");
  subSheet.getRange(1, 1, 1, subHeaders.length).setValues([subHeaders]).setFontWeight("bold").setBackground("#1e4620").setFontColor("#ffffff");

  const propHeaders = ["property_code","property_type","status","rent_price","project_name","map_url","shuttle_bus","accept_foreigner","pets_allowed","bedrooms","bathrooms","land_size","area_size","address_display","appliances_list","furniture_list","image_url","owner_name","sub_district","district"];
  const propSheet = getOrCreateSheet(ss, "properties");
  propSheet.getRange(1, 1, 1, propHeaders.length).setValues([propHeaders]).setFontWeight("bold").setBackground("#1a5276").setFontColor("#ffffff");

  const ctHeaders = ["contract_code","property_code","tenant_name","start_date","expiry_date","rent_amount","status","notes"];
  const ctSheet = getOrCreateSheet(ss, "contracts");
  ctSheet.getRange(1, 1, 1, ctHeaders.length).setValues([ctHeaders]).setFontWeight("bold").setBackground("#4a235a").setFontColor("#ffffff");

  Logger.log("✅ setupSheets() เสร็จสมบูรณ์");
}


// ═════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
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
