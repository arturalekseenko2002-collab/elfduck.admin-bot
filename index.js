// =====================================================
// ================= ELF DUCK ADMIN BOT =================
// =====================================================
import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

// =====================================================
// ===================== CONFIG/ENV =====================
// =====================================================
const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const API_URL = process.env.API_URL;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) throw new Error("ADMIN_BOT_TOKEN is missing");
if (!API_URL) throw new Error("API_URL is missing");
if (!ADMIN_API_TOKEN) throw new Error("ADMIN_API_TOKEN is missing");

// =====================================================
// ======================= HELPERS ======================
// =====================================================
const bot = new Telegraf(BOT_TOKEN);

const lastBotMessageIdByChat = new Map();

const forgetBotMessage = (chatId, messageId) => {
  const safeChatId = String(chatId || "");
  const safeMessageId = Number(messageId || 0);
  if (!safeChatId || !safeMessageId) return;

  const current = Number(lastBotMessageIdByChat.get(safeChatId) || 0);
  if (current === safeMessageId) {
    lastBotMessageIdByChat.delete(safeChatId);
  }
};

const replaceBotMessage = async (ctx, sendFn) => {
  const chatId = String(ctx?.chat?.id || "");
  if (!chatId) {
    return sendFn();
  }

  const prevMessageId = Number(lastBotMessageIdByChat.get(chatId) || 0);

  if (prevMessageId) {
    try {
      await ctx.telegram.deleteMessage(chatId, prevMessageId);
    } catch {}
    lastBotMessageIdByChat.delete(chatId);
  }

  const sent = await sendFn();
  const nextMessageId = Number(sent?.message_id || 0);

  if (nextMessageId) {
    lastBotMessageIdByChat.set(chatId, nextMessageId);
  }

  return sent;
};

bot.use(async (ctx, next) => {
  const originalReply = ctx.reply.bind(ctx);
  const originalReplyWithPhoto = ctx.replyWithPhoto.bind(ctx);
  const originalReplyWithDocument = ctx.replyWithDocument?.bind(ctx);
  const originalReplyWithMediaGroup = ctx.replyWithMediaGroup?.bind(ctx);

  ctx.reply = (...args) => replaceBotMessage(ctx, () => originalReply(...args));
  ctx.replyWithPhoto = (...args) => replaceBotMessage(ctx, () => originalReplyWithPhoto(...args));

  if (originalReplyWithDocument) {
    ctx.replyWithDocument = (...args) =>
      replaceBotMessage(ctx, () => originalReplyWithDocument(...args));
  }

  if (originalReplyWithMediaGroup) {
    ctx.replyWithMediaGroup = async (...args) => {
      const chatId = String(ctx?.chat?.id || "");
      if (!chatId) {
        return originalReplyWithMediaGroup(...args);
      }

      const prevMessageId = Number(lastBotMessageIdByChat.get(chatId) || 0);
      if (prevMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, prevMessageId);
        } catch {}
        lastBotMessageIdByChat.delete(chatId);
      }

      const sentList = await originalReplyWithMediaGroup(...args);
      const lastItem = Array.isArray(sentList) ? sentList[sentList.length - 1] : null;
      const nextMessageId = Number(lastItem?.message_id || 0);

      if (nextMessageId) {
        lastBotMessageIdByChat.set(chatId, nextMessageId);
      }

      return sentList;
    };
  }

  return next();
});

const isAdmin = (ctx) => ADMIN_IDS.includes(String(ctx.from?.id || ""));

const api = async (path, options = {}) => {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": ADMIN_API_TOKEN,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
};

const isValidUrl = (s) => /^https?:\/\/\S+$/i.test(s);

function translitRuToLat(input) {
  const s = String(input || "").trim().toLowerCase();
  const map = {
    а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"e", ж:"zh", з:"z", и:"i", й:"y",
    к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f",
    х:"h", ц:"ts", ч:"ch", ш:"sh", щ:"sch", ъ:"", ы:"y", ь:"", э:"e", ю:"yu", я:"ya",
  };

  let out = "";
  for (const ch of s) {
    if (map[ch] !== undefined) out += map[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }

  out = out.replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  if (out.length < 2) out = "category";
  if (out.length > 32) out = out.slice(0, 32).replace(/-+$/, "");
  return out;
}

// =====================================================
// ====================== UI MENU =======================
// =====================================================
const managerMainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📦 Наличие", "fl_builder_start")],
    [Markup.button.callback("💰 Начислить кэшбек по @username", "cashback_grant_start")],
    [Markup.button.callback("🏪 Точка самовывоза", "pp_list")],
  ]);

const superAdminMainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("➕ Создать категорию (конструктор)", "cat_builder_start")],
    [Markup.button.callback("➕ Создать товар (конструктор)", "prod_builder_start")],
    [Markup.button.callback("🍓 Вкусы / наличие", "fl_builder_start")],
    [Markup.button.callback("💰 Начислить кэшбек по @username", "cashback_grant_start")],
    [Markup.button.callback("🏪 Точки самовывоза", "pp_list")],
    [Markup.button.callback("✏️ Редактировать категорию", "cat_edit_start")],
    [Markup.button.callback("📋 Список категорий", "cat_list")],
  ]);

const mainMenu = (ctx) => (isSuperAdmin(ctx) ? superAdminMainMenu() : managerMainMenu());

const pickupPointManagerMenu = (ppId, options = {}) => {
  const isSuper = options?.isSuper === true;

  const rows = [
    [Markup.button.callback("📍 Адрес", `pp_edit_address:${ppId}`)],
    [Markup.button.callback("🕒 График на сегодня", `pp_edit_today_schedule:${ppId}`)],
  ];

  if (isSuper) {
    rows.push(
      [Markup.button.callback("🔔 ID канала уведомлений", `pp_edit_orders_chat:${ppId}`)],
      [Markup.button.callback("📊 ID канала статистики", `pp_edit_stats_chat:${ppId}`)],
    );
  }

  rows.push(
    [Markup.button.callback("💳 Настроить оплату", `pp_payment_menu:${ppId}`)],
    [Markup.button.callback("⬅️ К списку", "pp_list")],
    [Markup.button.callback("🏠 Меню", "menu")],
  );

  return Markup.inlineKeyboard(rows);
};

const isPickupPointManager = async (ctx, pickupPointId) => {
  if (isSuperAdmin(ctx)) return true;

  const myTelegramId = String(ctx?.from?.id || "").trim();
  const safePickupPointId = String(pickupPointId || "").trim();

  if (!myTelegramId || !safePickupPointId) return false;

  try {
    const r = await fetch(`${API_URL}/pickup-points?active=0`);
    const data = await r.json().catch(() => ({}));

    const pickupPoints = Array.isArray(data?.pickupPoints)
      ? data.pickupPoints
      : Array.isArray(data)
      ? data
      : [];

    const point = pickupPoints.find((p) => String(p?._id || "") === safePickupPointId);
    if (!point) return false;

    return Array.isArray(point.allowedAdminTelegramIds)
      ? point.allowedAdminTelegramIds.map((x) => String(x)).includes(myTelegramId)
      : false;
  } catch (e) {
    console.error("isPickupPointManager error:", e);
    return false;
  }
};

// =====================================================
// ===================== BOT STATE ======================
// =====================================================
const state = new Map(); // chatId -> { mode, step, data }
const getState = (chatId) => state.get(String(chatId));
const setState = (chatId, st) => state.set(String(chatId), st);
const clearState = (chatId) => state.delete(String(chatId));
const defaultCashbackGrantData = () => ({
  username: "",
  amountZl: 0,
});

// =====================================================
// ================= CASHBACK GRANT WIZARD ==============
// =====================================================

const CASHBACK_GRANT_STEPS = ["username", "amount", "confirm"];

const renderCashbackGrantPreview = (d = {}) => {
  const lines = [];
  lines.push("💰 *Начисление кэшбека — превью*");
  lines.push("");
  lines.push(`• username: *${d.username || "—"}*`);
  lines.push(`• сумма: *${Number(d.amountZl || 0).toFixed(2)} zł*`);
  // lines.push(`• комментарий: ${d.note ? `*${d.note}*` : "—"}`);
  return lines.join("\n");
};

const cashbackGrantNavKeyboard = (stepIndex) => {
  const backBtn = stepIndex > 0
    ? Markup.button.callback("⬅️ Назад", "cashback_grant_back")
    : null;

  const cancelBtn = Markup.button.callback("✖️ Отмена", "cashback_grant_cancel");

  return backBtn
    ? Markup.inlineKeyboard([[backBtn, cancelBtn]])
    : Markup.inlineKeyboard([[cancelBtn]]);
};

const askCashbackGrantStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cashback_grant") return;

  const step = CASHBACK_GRANT_STEPS[st.step];
  const preview = renderCashbackGrantPreview(st.data || {});

  if (step === "username") {
    return ctx.reply(
      `${preview}\n\nВведите *username пользователя* в формате: \`@username\``,
      { parse_mode: "Markdown", ...cashbackGrantNavKeyboard(st.step) }
    );
  }

  if (step === "amount") {
    return ctx.reply(
      `${preview}\n\nВведите *сумму начисления* в zł, пример: \`25\` или \`37.5\``,
      { parse_mode: "Markdown", ...cashbackGrantNavKeyboard(st.step) }
    );
  }

  // if (step === "note") {
  //   return ctx.reply(
  //     `${preview}\n\nВведите *комментарий* для истории начисления или отправьте \`-\`, если без комментария.`,
  //     { parse_mode: "Markdown", ...cashbackGrantNavKeyboard(st.step) }
  //   );
  // }

  if (step === "confirm") {
    return ctx.reply(
      `${preview}\n\nПодтвердить начисление кэшбека?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Начислить", "cashback_grant_confirm")],
          [
            Markup.button.callback("⬅️ Назад", "cashback_grant_back"),
            Markup.button.callback("✖️ Отмена", "cashback_grant_cancel"),
          ],
        ]),
      }
    );
  }
};

// =====================================================
// =================== CATEGORY BUILDER =================
// =====================================================

// ----- Builder steps order -----
const BUILDER_STEPS = [
  "variant",
  "assetsAndTitle",
  "badge",
  "sortOrder",
  "isActive",
  "confirm",
];

// =====================================================
// =================== PRODUCT BUILDER =================
// =====================================================

const PRODUCT_BUILDER_STEPS = [
  "category",
  "titles",
  "price",
  "cardImages",
  "layout",
  "badge",
  "orderImage",
  "titleModal",
  "accentColor",
  "sortOrder",
  "isActive",
  "confirm",
];

// =================== PRODUCT BUILDER (WIZARD) ===================

// ===== Product builder: presets for layout =====
const PRODUCT_LAYOUTS = [
  {
    id: 1,
    label: "Вариант 1 — утка справа / кнопки справа",
    value: {
      classCardDuck: "productCardImageRight",
      classActions: "productActionsRight",
    },
  },
  {
    id: 2,
    label: "Вариант 2 — утка слева / кнопки слева",
    value: {
      classCardDuck: "productCardImageLeft",
      classActions: "productActionsLeft",
    },
  },
];

// ----- defaults for new product -----
const defaultProductData = () => ({
  categoryKey: "",

  title1: "",
  title2: "",
  titleModal: "",
  price: 0,

  cardBgUrl: "",
  cardDuckUrl: "",
  orderImgUrl: "",

  classCardDuck: "",
  classActions: "",

  classNewBadge: "",
  newBadge: "",

  accentColor: "", // "32, 130, 231"

  sortOrder: 0,
  isActive: true,
});

// ===== optional: step images (can be empty) =====
const PRODUCT_STEP_IMAGES = {
  category: "",
  titles: "",
  price: "",
  cardImages: "",
  layout: "",
  badge: "",
  orderImage: "",
  titleModal: "",
  accentColor: "",
  sortOrder: "",
  isActive: "",
  confirm: "",
};

const renderProductPreview = (d) => {
  const lines = [];
  lines.push("🧩 *Конструктор товара — превью*");
  lines.push("");
  lines.push(`• категория: *${d.categoryKey || "—"}*`);
  lines.push(`• название (1): *${d.title1 || "—"}*`);
  lines.push(`• название (2): *${d.title2 || "—"}*`);
  lines.push(`• цена: *${Number(d.price || 0)}*`);
  lines.push(`• фон (карточка): ${d.cardBgUrl || "—"}`);
  lines.push(`• утка (карточка): ${d.cardDuckUrl || "—"}`);
  lines.push(
    `• расположение: ${d.classCardDuck ? `\`${d.classCardDuck}\`` : "—"} / ${
      d.classActions ? `\`${d.classActions}\`` : "—"
    }`
  );
  lines.push(`• бейдж: ${d.newBadge ? `*${d.newBadge}* (\`${d.classNewBadge}\`)` : "—"}`);
  lines.push(`• картинка (оформление): ${d.orderImgUrl || "—"}`);
  lines.push(`• название (оформление): *${d.titleModal || "—"}*`);
  lines.push(`• цвет (RGB): ${d.accentColor ? `\`${d.accentColor}\`` : "—"}`);
  lines.push(`• sortOrder: *${d.sortOrder}*`);
  lines.push(`• isActive: *${d.isActive ? "true" : "false"}*`);
  return lines.join("\n");
};

// =====================================================
// =================== FLAVOR BUILDER ==================
// =====================================================

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isSuperAdmin = (ctx) => SUPER_ADMIN_IDS.includes(String(ctx.from?.id || ""));

const slugify = (s) =>
  translitRuToLat(String(s || ""))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 32) || "flavor";

const isHex = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s || "").trim());

const FL_BUILDER_STEPS = [
  "product",      // выбрать товар
  "mode",         // новый вкус или наличие существующего
  "newFlavor",    // ввод label + 2 цвета
  "pickFlavor",   // выбрать существующий вкус
  "pickupPoint",  // выбрать точку
  "qty",          // ввести количество
  "confirm",      // подтвердить
];

const defaultFlavorBuilderData = () => ({
  productId: "",
  productTitle: "",

  mode: "", // "new" | "stock"

  // flavor meta
  flavorId: "",
  flavorKey: "",
  label: "",
  gradient: ["", ""],

  // stock target
  pickupPointId: "",
  pickupPointLabel: "",

  totalQty: null,
});

const renderFlavorBuilderPreview = (d = {}) => {
  const lines = [];
  lines.push("🍓 *Вкусы / наличие*");

  // показываем ТОЛЬКО заполненное (без “—”)
  if (d.productTitle) lines.push(`\nТовар: *${String(d.productTitle)}*`);

  if (d.mode) {
    const modeLabel =
      d.mode === "new" ? "добавить новый вкус" :
      d.mode === "stock" ? "обновить наличие" : "";
    if (modeLabel) lines.push(`Действие: *${modeLabel}*`);
  }

  if (d.label) lines.push(`Вкус: *${String(d.label)}*`);

  if (Array.isArray(d.gradient) && d.gradient[0] && d.gradient[1]) {
    lines.push(`Цвета: \`${d.gradient[0]}\`, \`${d.gradient[1]}\``);
  }

  if (d.pickupPointLabel) lines.push(`Точка: *${String(d.pickupPointLabel)}*`);

  // qty показываем только если реально вводили
  if (typeof d.totalQty === "number") {
    lines.push(`Количество: *${d.totalQty}*`);
  }

  return lines.join("\n");
};

// Доступные точки для менеджера:
// - супер-админ видит все
// - обычный менеджер видит только точки где его telegramId в allowedAdminTelegramIds
const fetchMyPickupPoints = async (ctx) => {
  const r = await fetch(`${API_URL}/pickup-points?active=0`);
  const data = await r.json().catch(() => ({}));
  const points = data.pickupPoints || [];
  const myId = String(ctx.from?.id || "");

  if (isSuperAdmin(ctx)) return points;

  return points.filter((p) =>
    Array.isArray(p.allowedAdminTelegramIds) && p.allowedAdminTelegramIds.includes(myId)
  );
};

const askFlavorStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  const step = FL_BUILDER_STEPS[st.step];
  const d = st.data || {};
  const preview = renderFlavorBuilderPreview(d);

  // 1) выбрать товар
  if (step === "product") {
    const r = await fetch(`${API_URL}/products?active=0`);
    const data = await r.json().catch(() => ({}));
    const products = data.products || [];

    if (!products.length) {
      clearState(ctx.chat.id);
      return ctx.reply("Товаров пока нет. Сначала создай товар.", mainMenu(ctx));
    }

    const kb = Markup.inlineKeyboard([
      ...products
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => [
          Markup.button.callback(
            `${p.isActive ? "✅" : "⛔️"} ${(p.title1 || "").trim()} ${(p.title2 || "").trim()}`.trim(),
            `fl_pick_product:${p._id}`
          ),
        ]),
      [Markup.button.callback("✖️ Отмена", "fl_cancel")],
    ]);

    return sendStepCard(ctx, {
      photoUrl: "",
      caption: `Выберите *товар*:`,
      keyboard: kb,
    });
  }

  // 2) режим
  if (step === "mode") {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("➕ Добавить новый вкус", "fl_set_mode:new")],
      [Markup.button.callback("📦 Добавить наличие", "fl_set_mode:stock")],
      [Markup.button.callback("⬅️ Назад", "fl_back"), Markup.button.callback("✖️ Отмена", "fl_cancel")],
    ]);

    return sendStepCard(ctx, {
      photoUrl: "",
      caption: `Выберите *что делаем*:`,
      keyboard: kb,
    });
  }

  // 3) новый вкус: ввод label + цвета
  if (step === "newFlavor") {
    const caption =
      `${preview}\n\n` +
      `Отправь *одним сообщением* через запятую:\n` +
      `*название вкуса, #ЦВЕТ1, #ЦВЕТ2*\n\n` +
      `Пример:\nCool Menthol, #92B8CB, #31460E`;

    return sendStepCard(ctx, {
      photoUrl: "",
      caption,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ Назад", "fl_back"), Markup.button.callback("✖️ Отмена", "fl_cancel")],
      ]),
    });
  }

  // 4) выбрать существующий вкус
  if (step === "pickFlavor") {
    // грузим товар, чтобы взять актуальные flavors
    const r = await fetch(`${API_URL}/products?active=0`);
    const data = await r.json().catch(() => ({}));
    const products = data.products || [];
    const prod = products.find((p) => String(p._id) === String(d.productId));

    const flavors = (prod?.flavors || []).filter((f) => f.isActive !== false);

    if (!flavors.length) {
      // если вкусов нет — отправим в newFlavor
      st.step = FL_BUILDER_STEPS.indexOf("newFlavor");
      st.data.mode = "new";
      setState(ctx.chat.id, st);
      return askFlavorStep(ctx);
    }

    const kb = Markup.inlineKeyboard([
      ...flavors.map((f) => [
        Markup.button.callback(f.label || f.flavorKey, `fl_pick_flavor:${f._id}`),
      ]),
      [Markup.button.callback("⬅️ Назад", "fl_back"), Markup.button.callback("✖️ Отмена", "fl_cancel")],
    ]);

    return sendStepCard(ctx, {
      photoUrl: "",
      caption: `${preview}\n\nВыберите *вкус*:`,
      keyboard: kb,
    });
  }

  // 5) выбрать точку
  if (step === "pickupPoint") {
    const points = await fetchMyPickupPoints(ctx);

    if (!points.length) {
      return ctx.reply("❌ У тебя нет доступных точек самовывоза. Добавь свой telegramId в точку (allowedAdminTelegramIds).");
    }

    const kb = Markup.inlineKeyboard([
      ...points
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => {
          const pointTitle = String(p?.title || "").trim();
          const pointAddress = String(p?.address || "").trim();
          const pointLabel = pointTitle && pointAddress
            ? `${pointTitle} (${pointAddress})`
            : pointTitle || pointAddress || "Без названия";

          return [
            Markup.button.callback(`${p.isActive ? "✅" : "⛔️"} ${pointLabel}`, `fl_pick_point:${p._id}`),
          ];
        }),
      [Markup.button.callback("⬅️ Назад", "fl_back"), Markup.button.callback("✖️ Отмена", "fl_cancel")],
    ]);

    return sendStepCard(ctx, {
      photoUrl: "",
      caption: `${preview}\n\nВыберите *точку самовывоза*:`,
      keyboard: kb,
    });
  }

  // 6) qty
  if (step === "qty") {
    // показываем текущее количество по выбранному вкусу на выбранной точке
    let currentQty = 0;

    try {
      const r = await fetch(`${API_URL}/products?active=0`);
      const data = await r.json().catch(() => ({}));
      const products = data.products || [];

      const prod = products.find((p) => String(p._id) === String(d.productId));

      if (prod) {
        // вкус может быть выбран по _id (flavorId) или по flavorKey
        const flavor =
          (prod.flavors || []).find((f) => String(f._id) === String(d.flavorId)) ||
          (prod.flavors || []).find((f) => String(f.flavorKey) === String(d.flavorKey));

        if (flavor) {
          const row = (flavor.stockByPickupPoint || []).find(
            (s) => String(s.pickupPointId) === String(d.pickupPointId)
          );
          currentQty = Number(row?.totalQty || 0);
        }
      }
    } catch (e) {
      // не ломаем шаг — просто покажем 0
      currentQty = 0;
    }

    return sendStepCard(ctx, {
      photoUrl: "",
      caption:
        `${preview}\n\n` +
        `Текущее количество на точке: *${currentQty}*\n\n` +
        `Введите *количество* (число 0+):`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ Назад", "fl_back"), Markup.button.callback("✖️ Отмена", "fl_cancel")],
      ]),
    });
  }

  // 7) confirm
  if (step === "confirm") {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Сохранить", "fl_confirm")],
      [Markup.button.callback("⬅️ Назад", "fl_back"), Markup.button.callback("✖️ Отмена", "fl_cancel")],
    ]);

    return sendStepCard(ctx, {
      photoUrl: "",
      caption: `${preview}\n\nПодтвердить сохранение?`,
      keyboard: kb,
    });
  }
};

const nextFlavorStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  st.step += 1;
  setState(ctx.chat.id, st);
  return askFlavorStep(ctx);
};

const productNavKeyboard = (stepIndex) => {
  const backBtn = stepIndex > 0 ? Markup.button.callback("⬅️ Назад", "prod_builder_back") : null;
  const cancelBtn = Markup.button.callback("✖️ Отмена", "prod_builder_cancel");
  return backBtn
    ? Markup.inlineKeyboard([[backBtn, cancelBtn]])
    : Markup.inlineKeyboard([[cancelBtn]]);
};

// ===== ask user per product step =====
const askProductStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  const step = PRODUCT_BUILDER_STEPS[st.step];
  const preview = renderProductPreview(st.data);

  // 1) CATEGORY (buttons from /categories)
  if (step === "category") {
    try {
      const r = await fetch(`${API_URL}/categories?active=0`);
      const data = await r.json().catch(() => ({}));
      const categories = Array.isArray(data) ? data : data.categories || [];

      if (!categories.length) {
        clearState(ctx.chat.id);
        return ctx.reply("Категорий пока нет. Сначала создай категорию.", mainMenu(ctx));
      }

      const kb = Markup.inlineKeyboard([
        ...categories
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((c) => [
            Markup.button.callback(
              `${c.isActive ? "✅" : "⛔️"} ${c.title}`,
              `prod_set_category:${c.key}`
            ),
          ]),
        [Markup.button.callback("✖️ Отмена", "prod_builder_cancel")],
      ]);

      const caption = `${preview}\n\nВыберите *категорию* для товара:`;
      return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.category, caption, keyboard: kb });
    } catch (e) {
      clearState(ctx.chat.id);
      return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
    }
  }

  // 2) TITLES (text)
  if (step === "titles") {
    const caption =
      `${preview}\n\n` +
      `Отправь *одним сообщением* через запятую:\n` +
      `*первая строка названия, вторая строка названия (или -)*\n\n` +
      `Пример:\nCHASER, FOR PODS 30 ML\nили\nSOLANA 30 ML, -`;

    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.titles, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 3) PRICE (text)
  if (step === "price") {
    const caption = `${preview}\n\nВведите *цену* (число), пример: 55`;
    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.price, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 4) CARD IMAGES (text)
  if (step === "cardImages") {
    const caption =
      `${preview}\n\n` +
      `Отправь *одним сообщением* через запятую:\n` +
      `*ссылка_на_фон_карточки, ссылка_на_утку_карточки*\n\n` +
      `Пример:\nhttps://...bg.png, https://...duck.png`;

    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.cardImages, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 5) LAYOUT (buttons)  ✅ вот тут “шаг layout”
  if (step === "layout") {
    const caption = `${preview}\n\nВыберите *расположение карточки*:`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("Вариант 1 — утка справа", "prod_set_layout:1")],
      [Markup.button.callback("Вариант 2 — утка слева", "prod_set_layout:2")],
      [Markup.button.callback("⬅️ Назад", "prod_builder_back"), Markup.button.callback("✖️ Отмена", "prod_builder_cancel")],
    ]);

    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.layout, caption, keyboard: kb });
  }

  // 6) BADGE (buttons)
  if (step === "badge") {
    const caption = `${preview}\n\nХотите добавить бейдж?`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("NEW", "prod_set_badge:NEW"), Markup.button.callback("SALE", "prod_set_badge:SALE")],
      [Markup.button.callback("НЕ ДОБАВЛЯТЬ", "prod_set_badge:NONE")],
      [Markup.button.callback("⬅️ Назад", "prod_builder_back"), Markup.button.callback("✖️ Отмена", "prod_builder_cancel")],
    ]);

    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.badge, caption, keyboard: kb });
  }

  // 7) ORDER IMAGE (text)
  if (step === "orderImage") {
    const caption = `${preview}\n\nВставь *ссылку на изображение для оформления заказа* (https://...)`;
    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.orderImage, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 8) TITLE MODAL (text)
  if (step === "titleModal") {
    const caption = `${preview}\n\nВведите *название для оформления заказа* (как в модалке)`;
    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.titleModal, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 9) ACCENT COLOR (text)
  if (step === "accentColor") {
    const caption = `${preview}\n\nВведите *цвет (RGB)* в формате: \`32, 130, 231\``;
    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.accentColor, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 10) SORT ORDER (text)
  if (step === "sortOrder") {
    const caption = `${preview}\n\nВведите *порядок в сетке* (0,1,2...)`;
    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.sortOrder, caption, keyboard: productNavKeyboard(st.step) });
  }

  // 11) IS ACTIVE (buttons)
  if (step === "isActive") {
    const caption = `${preview}\n\nТовар активен?`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Включить", "prod_set_isActive:true")],
      [Markup.button.callback("⛔️ Выключить", "prod_set_isActive:false")],
      [Markup.button.callback("⬅️ Назад", "prod_builder_back"), Markup.button.callback("✖️ Отмена", "prod_builder_cancel")],
    ]);

    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.isActive, caption, keyboard: kb });
  }

  // 12) CONFIRM (buttons)
  if (step === "confirm") {
    const caption = `${preview}\n\n*Вопрос:*\nПодтвердить создание товара?`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Создать", "prod_builder_confirm")],
      [Markup.button.callback("⬅️ Назад", "prod_builder_back"), Markup.button.callback("✖️ Отмена", "prod_builder_cancel")],
    ]);

    return sendStepCard(ctx, { photoUrl: PRODUCT_STEP_IMAGES.confirm, caption, keyboard: kb });
  }
};

const nextProductStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  st.step += 1;
  setState(ctx.chat.id, st);
  return askProductStep(ctx);
};

// ===== Step images (Pinata) =====
const CAT_STEP_IMAGES = {
  variant: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafkreicopjyvhtoec43taajyah3rsb22hriuwm4mdiamilbbqztmfldmoe",
  assetsAndTitle: "",
  sortOrder: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeiaectbg64b5iud6p3thvqmciwusne4xvn2woosyso3cgqruoqx3wy",
  isActive: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeibqdkr5tk6ozooh4lngx37coih63v7m2ufrspimstxccxbcuqfzke",
  confirm: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafkreiembjot7lxn3lvjwkjc5nswqizgldije3hrib2jy5hdxkgtfnzh7q",
};

// ===== Send ONE message: photo + caption + keyboard (or text fallback) =====
const sendStepCard = async (ctx, { photoUrl, caption, keyboard }) => {
  const extra = {
    caption,
    parse_mode: "Markdown",
    ...(keyboard?.reply_markup ? { reply_markup: keyboard.reply_markup } : {}),
  };

  if (photoUrl && isValidUrl(photoUrl)) {
    return ctx.replyWithPhoto({ url: photoUrl }, extra);
  }

  // текстовый fallback
  const extraText = {
    parse_mode: "Markdown",
    ...(keyboard?.reply_markup ? { reply_markup: keyboard.reply_markup } : {}),
  };
  return ctx.reply(caption, extraText);
};

// ----- defaults for new category -----
const defaultCategoryData = () => ({
  layoutVariant: null,
  key: "",
  title: "",
  badgeText: "",
  badgeSide: "left",
  showOverlay: false,
  classCardDuck: "cardImageLeft",
  titleClass: "cardTitle",
  cardBgUrl: "",
  cardDuckUrl: "",
  sortOrder: 0,
  isActive: true,
});

// ----- options: managers see `label`, DB stores `value` -----
const DUCK_CLASS_OPTIONS = [
  { label: "высота 95%, слева", value: "cardImageLeft" },
  { label: "высота 60%, справа", value: "cardImageRight" },
  { label: "высота 60%, слева", value: "cardImageLeft2" },
  { label: "высота 95%, справа", value: "cardImageRight2" },
];

const TITLE_CLASS_OPTIONS = [
  { label: "по центру", value: "cardTitle" },
  { label: "сверху", value: "cardTitle2" },
];

// ===== 4 готовых варианта карточки категории =====
const CATEGORY_VARIANTS = [
  {
    id: 1,
    label: "ВАРИАНТ 1",
    value: { layoutVariant: 1, classCardDuck: "cardImageLeft", titleClass: "cardTitle", showOverlay: true },
  },
  {
    id: 2,
    label: "ВАРИАНТ 2",
    value: { layoutVariant: 2, classCardDuck: "cardImageRight", titleClass: "cardTitle2", showOverlay: false },
  },
  {
    id: 3,
    label: "ВАРИАНТ 3",
    value: { layoutVariant: 3, classCardDuck: "cardImageLeft2", titleClass: "cardTitle2", showOverlay: false },
  },
  {
    id: 4,
    label: "ВАРИАНТ 4",
    value: { layoutVariant: 4, classCardDuck: "cardImageRight2", titleClass: "cardTitle", showOverlay: true },
  },
];

const getVariantLabel = (v) =>
  CATEGORY_VARIANTS.find((x) => x.id === v)?.label || (v ? `ВАРИАНТ ${v}` : "—");

const getDuckLabel = (value) =>
  DUCK_CLASS_OPTIONS.find((o) => o.value === value)?.label || value || "—";

const getTitleLabel = (value) =>
  TITLE_CLASS_OPTIONS.find((o) => o.value === value)?.label || value || "—";

// ----- render preview text -----
const renderCategoryPreview = (d) => {
  const lines = [];
  lines.push("🧩 *Конструктор категории — превью*");
  lines.push("");
  lines.push(`• вариант: *${getVariantLabel(d.layoutVariant)}*`);
  // lines.push(`• key: \`${d.key || "—"}\``);
  lines.push(`• title: *${d.title || "—"}*`);
  lines.push(`• badgeText: ${d.badgeText ? `*${d.badgeText}*` : "—"}`);
  lines.push(`• badgeSide: *${d.badgeText ? (d.badgeSide || "left") : "—"}*`);
  lines.push(`• showOverlay: *${d.showOverlay ? "true" : "false"}*`);
  lines.push(`• classCardDuck: ${getDuckLabel(d.classCardDuck)} (\`${d.classCardDuck}\`)`);
  lines.push(`• titleClass: ${getTitleLabel(d.titleClass)} (\`${d.titleClass}\`)`);
  lines.push(`• cardBgUrl: ${d.cardBgUrl || "—"}`);
  lines.push(`• cardDuckUrl: ${d.cardDuckUrl || "—"}`);
  lines.push(`• sortOrder: *${d.sortOrder}*`);
  lines.push(`• isActive: *${d.isActive ? "true" : "false"}*`);
  return lines.join("\n");
};

// =====================================================
// =================== PICKUP POINTS ===================
// ====================================================

const renderPickupPointPreview = (p) => {
  const lines = [];
  lines.push("🏪 *Точка самовывоза — превью*");
  lines.push("");
  lines.push(`• название: *${p?.title || "—"}*`);
  lines.push(`• адрес: *${p?.address || "—"}*`);
  lines.push(
    `• менеджеры (ID): ${
      Array.isArray(p?.allowedAdminTelegramIds) && p.allowedAdminTelegramIds.length
        ? p.allowedAdminTelegramIds.join(", ")
        : "—"
    }`
  );
  lines.push(`• канал уведомлений: *${p?.notificationChatId || "—"}*`);
  lines.push(`• канал статистики: *${p?.statsChatId || p?.notificationChatId || "—"}*`);

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const todaySchedule =
    p?.scheduleByDate?.[todayKey] ||
    p?.scheduleByDate?.get?.(todayKey) ||
    null;

  const autoStatsTime = String(todaySchedule?.to || p?.statsSendTime || "23:59").trim();
  lines.push(`• время отправки статистики: *${autoStatsTime}*`);

  const pm = Array.isArray(p?.paymentConfig?.methods) ? p.paymentConfig.methods : [];
  lines.push(
    `• способы оплаты: ${
      pm.length
        ? pm
            .map((m) => `\`${String(m.key || "").replace(/`/g, "")}${m.isActive === false ? " (off)" : ""}\``)
            .join(", ")
        : "—"
    }`
  );

  lines.push(`• sortOrder: *${Number(p?.sortOrder ?? 0)}*`);
  lines.push(`• isActive: *${p?.isActive ? "true" : "false"}*`);
  return lines.join("\n");
};

const ppMenuKeyboard = (id) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("🟢/🔴 Вкл/Выкл", `pp_toggle:${id}`),
      Markup.button.callback("🗑 Удалить", `pp_delete:${id}`),
    ],
    [
      Markup.button.callback("📝 Название", `pp_prompt:title:${id}`),
      Markup.button.callback("📍 Адрес", `pp_prompt:address:${id}`),
    ],
    [Markup.button.callback("🗓 График на сегодня", `pp_prompt_today_schedule:${id}`)],
    [Markup.button.callback("👤 ID менеджеров", `pp_prompt:allowedAdminTelegramIds:${id}`)],
    [Markup.button.callback("🔔 ID канала уведомлений", `pp_prompt:notificationChatId:${id}`)],
    [Markup.button.callback("📊 ID канала статистики", `pp_prompt:statsChatId:${id}`)],
    [Markup.button.callback("💳 Настроить оплату", `pp_payment_menu:${id}`)],
    [Markup.button.callback("🔢 sortOrder", `pp_prompt:sortOrder:${id}`)],
    [Markup.button.callback("⬅️ К списку", "pp_list")],
    [Markup.button.callback("🏠 Меню", "cat_builder_cancel")],
  ]);

const ppPaymentMenuKeyboard = (id) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("BLIK", `pp_pay_prompt:${id}:blik`)],
    [Markup.button.callback("Криптовалюта", `pp_pay_prompt:${id}:crypto`)],
    [Markup.button.callback("Укр. карта", `pp_pay_prompt:${id}:ua_card`)],
    [Markup.button.callback("Наличные", `pp_pay_prompt:${id}:cash`)],
    [Markup.button.callback("⬅️ К точке", `pp_open:${id}`)],
  ]);

const ppListKeyboard = (points = [], ctx = null) =>
  Markup.inlineKeyboard([
    ...points
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((p) => [
        Markup.button.callback(
          `${p.isActive ? "✅" : "⛔️"} ${p.title || p.address || "(без названия)"}`,
          `pp_open:${p._id}`
        ),
      ]),
    ...(ctx && isSuperAdmin(ctx) ? [[Markup.button.callback("➕ Создать точку", "pp_create")]] : []),
    [Markup.button.callback("🏠 Меню", "menu")],
  ]);

const askPickupCreateStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "pp_create") return;

  const step = Number(st.step || 0);

  // step 0: title,address
  if (step === 0) {
    const caption =
      "🏪 *Создание точки самовывоза*\n\n" +
      "Отправь *одним сообщением* через запятую:\n" +
      "*название, адрес*\n\n" +
      "Пример:\nKrucza, ul. Krucza 03, Śródmieście";

    return sendStepCard(ctx, {
      photoUrl: "",
      caption,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback("✖️ Отмена", "pp_cancel")]]),
    });
  }

  // step 1: managers ids
  if (step === 1) {
    const d = st.data || {};
    const caption =
      `${renderPickupPointPreview(d)}\n\n` +
      "Вставь *ID менеджеров* через запятую (telegramId).\n" +
      "Если никого не добавлять — отправь `-`.\n\n" +
      "Пример:\n123456789, 987654321";

    return sendStepCard(ctx, {
      photoUrl: "",
      caption,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ Назад", "pp_back"), Markup.button.callback("✖️ Отмена", "pp_cancel")],
      ]),
    });
  }

  // step 2: confirm
  if (step === 2) {
    const d = st.data || {};
    const caption = `${renderPickupPointPreview(d)}\n\n*Вопрос:*\nПодтвердить создание точки?`;

    return sendStepCard(ctx, {
      photoUrl: "",
      caption,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("✅ Создать", "pp_create_confirm")],
        [Markup.button.callback("⬅️ Назад", "pp_back"), Markup.button.callback("✖️ Отмена", "pp_cancel")],
      ]),
    });
  }
};

const nextPickupCreateStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "pp_create") return;
  st.step = Number(st.step || 0) + 1;
  setState(ctx.chat.id, st);
  return askPickupCreateStep(ctx);
};

// ----- quick edit menu (no wizard) -----
const renderEditMenuText = (d) => {
  const lines = [];
  lines.push("✏️ *Редактирование категории*");
  lines.push("");
  lines.push(`• key: \`${d.key || "—"}\``);
  lines.push(`• title: *${d.title || "—"}*`);
  lines.push(`• badgeText: ${d.badgeText ? `*${d.badgeText}*` : "—"}`);
  lines.push(`• showOverlay: *${d.showOverlay ? "true" : "false"}*`);
  lines.push(`• classCardDuck: ${getDuckLabel(d.classCardDuck)} (\`${d.classCardDuck || "—"}\`)`);
  lines.push(`• titleClass: ${getTitleLabel(d.titleClass)} (\`${d.titleClass || "—"}\`)`);
  lines.push(`• cardBgUrl: ${d.cardBgUrl || "—"}`);
  lines.push(`• cardDuckUrl: ${d.cardDuckUrl || "—"}`);
  lines.push(`• sortOrder: *${d.sortOrder ?? 0}*`);
  lines.push(`• isActive: *${d.isActive ? "true" : "false"}*`);
  lines.push("");
  lines.push("Выбери, что поменять:");
  return lines.join("\n");
};

const editMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("🟢/🔴 isActive", "cat_edit_toggle_isActive"),
      Markup.button.callback("🌓 overlay", "cat_edit_toggle_overlay"),
    ],
    [
      Markup.button.callback("📝 title", "cat_edit_prompt:title"),
      Markup.button.callback("🔑 key", "cat_edit_prompt:key"),
    ],
    [
      Markup.button.callback("🏷 badgeText", "cat_edit_prompt:badgeText"),
      Markup.button.callback("🔢 sortOrder", "cat_edit_prompt:sortOrder"),
    ],
    [Markup.button.callback("🖼 фон (cardBgUrl)", "cat_edit_prompt:cardBgUrl")],
    [Markup.button.callback("🦆 утка (cardDuckUrl)", "cat_edit_prompt:cardDuckUrl")],
    [
      Markup.button.callback("📐 classCardDuck", "cat_edit_pick_classDuck"),
      Markup.button.callback("🔤 titleClass", "cat_edit_pick_titleClass"),
    ],
    [Markup.button.callback("🧩 Открыть конструктор", "cat_edit_open_wizard")],
    [
      Markup.button.callback("⬅️ К списку", "cat_edit_start"),
      Markup.button.callback("🏠 Меню", "cat_builder_cancel"),
    ],
  ]);

const sendEditMenu = async (ctx) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  return ctx.replyWithMarkdownV2(
    renderEditMenuText(st.data).replace(/[-.()]/g, "\\$&"),
    editMenuKeyboard()
  );
};

const builderNavKeyboard = (stepIndex) => {
  const backBtn = stepIndex > 0 ? Markup.button.callback("⬅️ Назад", "cat_builder_back") : null;
  const cancelBtn = Markup.button.callback("✖️ Отмена", "cat_builder_cancel");

  if (backBtn) return Markup.inlineKeyboard([[backBtn, cancelBtn]]);
  return Markup.inlineKeyboard([[cancelBtn]]);
};

// ----- ask user per step -----
const askStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  const step = BUILDER_STEPS[st.step];

  const preview = renderCategoryPreview(st.data);
  const navKb = builderNavKeyboard(st.step);

  // Текст вопроса для каждого шага
  let question = "";

  if (step === "variant") {
    const caption = `${preview}\n\nВыберите *вариант карточки* (готовая разметка):`;
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback("ВАРИАНТ 1", "cat_builder_set_variant:1"),
        Markup.button.callback("ВАРИАНТ 2", "cat_builder_set_variant:2"),
      ],
      [
        Markup.button.callback("ВАРИАНТ 3", "cat_builder_set_variant:3"),
        Markup.button.callback("ВАРИАНТ 4", "cat_builder_set_variant:4"),
      ],
      [Markup.button.callback("✖️ Отмена", "cat_builder_cancel")],
    ]);

    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES.variant, caption, keyboard: kb });
  }

  if (step === "sortOrder") {
    question = "Введите *порядок в сетке* (0,1,2...)";
  } else if (step === "confirm") {
    const isEdit = st?.mode === "cat_edit";
    question = isEdit ? "Подтвердить обновление категории?" : "Подтвердить создание категории?";
  }

  if (step === "assetsAndTitle") {
    const caption =
      `${preview}\n\n` +
      `Отправь *одним сообщением* через запятую:\n` +
      `*ссылка_на_фон, ссылка_на_утку, название категории*\n\n` +
      `Пример:\nhttps://...bg.png, https://...duck.png, ЖИДКОСТИ`;

    const kb = builderNavKeyboard(st.step);
    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES.assetsAndTitle, caption, keyboard: kb });
  }

  if (step === "badge") {
    const caption = `${preview}\n\nХотите добавить бейдж?`;
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback("SALE (слева)", "cat_builder_set_badge:SALE:left"),
        Markup.button.callback("SALE (справа)", "cat_builder_set_badge:SALE:right"),
      ],
      [
        Markup.button.callback("NEW DROP (слева)", "cat_builder_set_badge:NEW DROP:left"),
        Markup.button.callback("NEW DROP (справа)", "cat_builder_set_badge:NEW DROP:right"),
      ],
      [Markup.button.callback("НЕ ДОБАВЛЯТЬ", "cat_builder_set_badge:NONE")],
      [Markup.button.callback("⬅️ Назад", "cat_builder_back"), Markup.button.callback("✖️ Отмена", "cat_builder_cancel")],
    ]);
    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES.badge, caption, keyboard: kb });
  }

  // Кнопочные шаги оставим как есть (там inline keyboard да/нет)
  // но превью всё равно можно отправить одним сообщением (см. ниже)

  // Если шаг НЕ кнопочный — отправляем 1 сообщение (картинка+подпись)
  const photoUrl = CAT_STEP_IMAGES[step];
  if (
    ["key", "title", "badgeText", "cardBgUrl", "cardDuckUrl", "sortOrder"].includes(step)
  ) {
    const caption = `${preview}\n\n*Вопрос:*\n${question}`;
    return sendStepCard(ctx, { photoUrl, caption, keyboard: navKb });
  }


  if (step === "isActive") {
    const caption = `${preview}\n\nКатегория активна?`;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Включить", "cat_builder_set_isActive:true")],
      [Markup.button.callback("⛔️ Выключить", "cat_builder_set_isActive:false")],
      [Markup.button.callback("⬅️ Назад", "cat_builder_back"), Markup.button.callback("✖️ Отмена", "cat_builder_cancel")],
    ]);
    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES[step], caption, keyboard: kb });
  }

  if (step === "confirm") {
    const st = getState(ctx.chat.id);
    const isEdit = st?.mode === "cat_edit";

    const caption = `${preview}\n\n*Вопрос:*\n${isEdit ? "Подтвердить обновление категории?" : "Подтвердить создание категории?"}`;

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          isEdit ? "💾 Сохранить" : "✅ Создать",
          isEdit ? "cat_edit_confirm" : "cat_builder_confirm"
        ),
      ],
      [
        Markup.button.callback("⬅️ Назад", "cat_builder_back"),
        Markup.button.callback("✖️ Отмена", "cat_builder_cancel"),
      ],
    ]);

    return sendStepCard(ctx, {
      photoUrl: CAT_STEP_IMAGES.confirm,
      caption,
      keyboard: kb,
    });
  }
};

const nextStep = async (ctx) => {
  const st = getState(ctx.chat.id);
  st.step += 1;
  setState(ctx.chat.id, st);
  return askStep(ctx);
};

// =====================================================
// ======================= COMMANDS =====================
// =====================================================

bot.action("menu", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const callbackMessageId = ctx.callbackQuery?.message?.message_id;

  if (callbackMessageId) {
    forgetBotMessage(ctx.chat.id, callbackMessageId);

    try {
      await ctx.deleteMessage(callbackMessageId);
    } catch {}
  }

  clearState(ctx.chat.id);
  return ctx.reply("🛠️ ELF DUCK — Admin Panel", mainMenu(ctx));
});

bot.start(async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("⛔️ Нет доступа");
  clearState(ctx.chat.id);

  if (ctx.message?.message_id) {
    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch {}
  }

  return ctx.reply("🛠️ ELF DUCK — Admin Panel", mainMenu(ctx));
});

bot.action("cashback_grant_start", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx)) return;

    setState(ctx.chat.id, {
      mode: "cashback_grant",
      step: 0,
      data: defaultCashbackGrantData(),
    });

    return askCashbackGrantStep(ctx);
  } catch (e) {
    console.error("cashback_grant_start error:", e);
  }
});

bot.action("cashback_grant_back", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx)) return;

    const st = getState(ctx.chat.id);
    if (!st || st.mode !== "cashback_grant") return;

    st.step = Math.max(0, Number(st.step || 0) - 1);
    setState(ctx.chat.id, st);
    return askCashbackGrantStep(ctx);
  } catch (e) {
    console.error("cashback_grant_back error:", e);
  }
});

bot.action("cashback_grant_cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery("Отменено");
    if (!isAdmin(ctx)) return;

    clearState(ctx.chat.id);
    return ctx.reply("Начисление кэшбека отменено.", mainMenu(ctx));
  } catch (e) {
    console.error("cashback_grant_cancel error:", e);
  }
});

bot.action("cashback_grant_confirm", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx)) return;

    const st = getState(ctx.chat.id);
    if (!st || st.mode !== "cashback_grant") return;

    const username = String(st.data?.username || "").trim().replace(/^@+/, "");
    const amountZl = Number(st.data?.amountZl || 0);
    // const note = String(st.data?.note || "").trim();

    if (!username) return ctx.reply("❌ Укажи username пользователя.");
    if (!(amountZl > 0)) return ctx.reply("❌ Сумма должна быть больше 0.");

    const result = await api("/admin/users/cashback/grant-by-username", {
      method: "POST",
      body: JSON.stringify({
        username,
        amountZl,
        // note,
        grantedByTelegramId: String(ctx.from?.id || ""),
        grantedByUsername: String(ctx.from?.username || ""),
      }),
    });

    clearState(ctx.chat.id);

    return ctx.reply(
      [
        "✅ Кэшбек начислен",
        `username: @${username}`,
        `сумма: ${amountZl.toFixed(2)} zł`,
        `новый баланс: ${Number(result?.cashbackBalance || 0).toFixed(2)} zł`,
      ].join("\n"),
      mainMenu(ctx)
    );
  } catch (e) {
    console.error("cashback_grant_confirm error:", e);
    return ctx.reply(`❌ Ошибка начисления: ${e.message}`);
  }
});

// =====================================================
// =================== PICKUP POINTS CRUD ==============
// =====================================================

bot.action("pp_list", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  try {
    const points = isSuperAdmin(ctx)
      ? await api("/pickup-points?active=0").then((data) => data.pickupPoints || [])
      : await fetchMyPickupPoints(ctx);

    if (!points.length) {
      return ctx.reply(
        "Точек самовывоза пока нет.",
        Markup.inlineKeyboard([
          ...(isSuperAdmin(ctx) ? [[Markup.button.callback("➕ Создать точку", "pp_create")]] : []),
          [Markup.button.callback("🏠 Меню", "menu")],
        ])
      );
    }

    return ctx.reply("🏪 *Точки самовывоза:*", {
      parse_mode: "Markdown",
      reply_markup: ppListKeyboard(points, ctx).reply_markup,
    });
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action("pp_create", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  setState(ctx.chat.id, {
    mode: "pp_create",
    step: 0,
    data: {
      title: "",
      address: "",
      sortOrder: 0,
      isActive: true,
      allowedAdminTelegramIds: [],
      notificationChatId: "",
      statsChatId: "",
      statsSendTime: "23:59",
      scheduleByDate: {},
    },
  });

  return askPickupCreateStep(ctx);
});

bot.action("pp_cancel", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  clearState(ctx.chat.id);
  return ctx.reply("Ок, отменено.", mainMenu(ctx));
});

bot.action("pp_back", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "pp_create") return;

  st.step = Math.max(0, Number(st.step || 0) - 1);
  setState(ctx.chat.id, st);
  return askPickupCreateStep(ctx);
});

bot.action("pp_create_confirm", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "pp_create") return;

  try {
    const d = st.data || {};
    if (!String(d.title || "").trim() && !String(d.address || "").trim()) {
      throw new Error("Нужно указать хотя бы название или адрес");
    }

    const payload = {
      title: String(d.title || "").trim(),
      address: String(d.address || "").trim(),
      sortOrder: Number(d.sortOrder || 0),
      isActive: d.isActive !== false,
      allowedAdminTelegramIds: Array.isArray(d.allowedAdminTelegramIds)
        ? d.allowedAdminTelegramIds.map((x) => String(x).trim()).filter(Boolean)
        : [],
      notificationChatId: String(d.notificationChatId || "").trim(),
      statsChatId: String(d.statsChatId || "").trim(),
      statsSendTime: String(d.statsSendTime || "23:59").trim(),
      scheduleByDate:
        d.scheduleByDate && typeof d.scheduleByDate === "object"
          ? d.scheduleByDate
          : {},
    };

    await api("/admin/pickup-points", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    clearState(ctx.chat.id);
    return ctx.reply(
      "✅ Точка создана",
      Markup.inlineKeyboard([
        [Markup.button.callback("🏪 К списку точек", "pp_list")],
        [Markup.button.callback("🏠 Меню", "cat_builder_cancel")],
      ])
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

bot.action(/pp_open:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const id = String(ctx.match[1] || "");

  try {
    const points = isSuperAdmin(ctx)
      ? await api("/pickup-points?active=0").then((data) => data.pickupPoints || [])
      : await fetchMyPickupPoints(ctx);
    const p = points.find((x) => String(x._id) === id);

    if (!p) return ctx.reply("Точка не найдена", mainMenu(ctx));

    setState(ctx.chat.id, { mode: "pp_open", ppId: id, data: p });

    return ctx.reply(renderPickupPointPreview(p), {
      parse_mode: "Markdown",
      reply_markup: (isSuperAdmin(ctx)
        ? ppMenuKeyboard(id)
        : pickupPointManagerMenu(id, { isSuper: isSuperAdmin(ctx) })
      ).reply_markup,
    });
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action(/pp_toggle:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const id = String(ctx.match[1] || "");

  try {
    const points = isSuperAdmin(ctx)
      ? await api("/pickup-points?active=0").then((data) => data.pickupPoints || [])
      : await fetchMyPickupPoints(ctx);
    const p = points.find((x) => String(x._id) === id);
    if (!p) return ctx.reply("Точка не найдена", mainMenu(ctx));

    const updated = await api(`/admin/pickup-points/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !p.isActive }),
    });

    const fresh = updated?.pickupPoint || updated;
    setState(ctx.chat.id, { mode: "pp_open", ppId: id, data: fresh });

    return ctx.reply(renderPickupPointPreview(fresh), {
      parse_mode: "Markdown",
      reply_markup: (isSuperAdmin(ctx) ? ppMenuKeyboard(id) : pickupPointManagerMenu(id)).reply_markup,
    });
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action(/pp_delete:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const id = String(ctx.match[1] || "");

  try {
    await api(`/admin/pickup-points/${id}`, { method: "DELETE" });
    clearState(ctx.chat.id);

    return ctx.reply(
      "🗑 Точка удалена",
      Markup.inlineKeyboard([
        [Markup.button.callback("🏪 К списку точек", "pp_list")],
        [Markup.button.callback("🏠 Меню", "cat_builder_cancel")],
      ])
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action(/pp_edit_address:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const pickupPointId = String(ctx.match[1] || "").trim();
  const allowed = await isPickupPointManager(ctx, pickupPointId);
  if (!allowed) {
    return ctx.answerCbQuery("Нет доступа", { show_alert: true });
  }

  if (!pickupPointId) return ctx.reply("❌ Точка не найдена.");

  setState(ctx.chat.id, {
    mode: "pp_prompt",
    field: "address",
    ppId: pickupPointId,
  });

return ctx.reply("Введите новый *адрес* (или `-` чтобы отменить)", {
  parse_mode: "Markdown",
  reply_markup: Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ К точке", `pp_open:${pickupPointId}`)],
    [Markup.button.callback("🏠 Меню", "menu")],
  ]).reply_markup,
});
});

bot.action(/pp_edit_today_schedule:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const pickupPointId = String(ctx.match[1] || "").trim();
  const allowed = await isPickupPointManager(ctx, pickupPointId);
  if (!allowed) {
    return ctx.answerCbQuery("Нет доступа", { show_alert: true });
  }

  if (!pickupPointId) return ctx.reply("❌ Точка не найдена.");

  setState(ctx.chat.id, {
    mode: "pp_prompt_today_schedule",
    pickupPointId,
  });

  return ctx.reply(
    "🗓 *График на сегодня*\n\n" +
      "Отправь одним сообщением:\n" +
      "`10:00-22:00`\n\n" +
      "или\n\n" +
      "`выходной`",
    {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ К точке", `pp_open:${pickupPointId}`)],
        [Markup.button.callback("🏠 Меню", "menu")],
      ]).reply_markup,
    }
  );
});

bot.action(/pp_edit_orders_chat:(.+)/, async (ctx) => {
  if (!isSuperAdmin(ctx)) {
    return ctx.answerCbQuery("Нет доступа", { show_alert: true });
  }
  await ctx.answerCbQuery();

  const pickupPointId = String(ctx.match[1] || "").trim();
  if (!pickupPointId) return ctx.reply("❌ Точка не найдена.");

  setState(ctx.chat.id, {
    mode: "pp_prompt",
    field: "notificationChatId",
    ppId: pickupPointId,
  });

  return ctx.reply("Введите *ID чата* для получения уведомлений о заказах", {
    parse_mode: "Markdown",
  });
});

bot.action(/pp_edit_stats_chat:(.+)/, async (ctx) => {
  if (!isSuperAdmin(ctx)) {
    return ctx.answerCbQuery("Нет доступа", { show_alert: true });
  }
  await ctx.answerCbQuery();

  const pickupPointId = String(ctx.match[1] || "").trim();
  if (!pickupPointId) return ctx.reply("❌ Точка не найдена.");

  setState(ctx.chat.id, {
    mode: "pp_prompt",
    field: "statsChatId",
    ppId: pickupPointId,
  });

  return ctx.reply("Введите *ID чата* для получения статистики по складу", {
    parse_mode: "Markdown",
  });
});

bot.action(/pp_prompt:(title|address|allowedAdminTelegramIds|notificationChatId|statsChatId|sortOrder):(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const field = String(ctx.match[1] || "");
  const id = String(ctx.match[2] || "");

  setState(ctx.chat.id, { mode: "pp_prompt", field, ppId: id });

  const prompts = {
    title: "Введите новое *название* (или `-` чтобы отменить)",
    address: "Введите новый *адрес* (или `-` чтобы отменить)",
    allowedAdminTelegramIds: "Введите *ID менеджеров* через запятую (telegramId) (или `-` чтобы очистить/отменить)",
    notificationChatId: "Введите *ID чата* для получения уведомлений о заказах",
    statsChatId: "Введите *ID чата* для получения статистики по складу",
    sortOrder: "Введите новый *sortOrder* (0,1,2...) (или `-` чтобы отменить)",
  };

  return ctx.reply(prompts[field] || "Введите новое значение", { parse_mode: "Markdown" });
});

bot.action(/^pp_prompt_today_schedule:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const pickupPointId = String(ctx.match[1] || "").trim();
  if (!pickupPointId) return ctx.reply("❌ Точка не найдена.");

  setState(ctx.chat.id, {
    mode: "pp_prompt_today_schedule",
    pickupPointId,
  });

  return ctx.reply(
    "🗓 *График на сегодня*\n\n" +
      "Отправь одним сообщением:\n" +
      "`10:00-22:00`\n\n" +
      "или\n\n" +
      "`выходной`",
    { parse_mode: "Markdown" }
  );
});

bot.action(/pp_payment_menu:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return;

  const id = String(ctx.match?.[1] || "").trim();
  if (!id) return;

  try {
    const points = isSuperAdmin(ctx)
      ? await api("/pickup-points?active=0").then((data) => data.pickupPoints || [])
      : await fetchMyPickupPoints(ctx);
    const point = points.find((x) => String(x._id) === id);

    if (!point) return ctx.answerCbQuery("Точка не найдена");

    const text =
      `${renderPickupPointPreview(point)}\n\n` +
      `Выберите способ оплаты для настройки.\n\n` +
      `Формат ввода далее: \`label | detailsValue | badge | on/off\``;

    if (ctx.callbackQuery?.message?.photo) {
      await ctx.editMessageCaption(text, {
        parse_mode: "Markdown",
        reply_markup: ppPaymentMenuKeyboard(id).reply_markup,
      });
    } else {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: ppPaymentMenuKeyboard(id).reply_markup,
      });
    }
  } catch (e) {
    console.error(e);
    await ctx.answerCbQuery("Ошибка");
  }
});

bot.action(/pp_pay_prompt:(.+):(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return;

  const id = String(ctx.match?.[1] || "").trim();
  const methodKey = String(ctx.match?.[2] || "").trim();
  if (!id || !methodKey) return;

  setState(ctx.chat.id, {
    mode: "pp_payment_prompt",
    pointId: id,
    methodKey,
  });

  const methodLabel =
    methodKey === "blik"
      ? "BLIK"
      : methodKey === "crypto"
      ? "Криптовалюта"
      : methodKey === "ua_card"
      ? "Украинская карта"
      : methodKey === "cash"
      ? "Наличные"
      : methodKey;

  return ctx.reply(
    `Введите настройки для *${methodLabel}* в формате:\n\n` +
      `*label | detailsValue | badge | on/off*\n\n` +
      `Пример для BLIK:\n` +
      "`BLIK | +48 576 471 380 | BLIK | on`\n\n" +
      `Пример для наличных:\n` +
      "`Наличные при получении | Оплата на месте | Наличные | on`",
    { parse_mode: "Markdown" }
  );
});

// =====================================================
// =================== PRODUCT BUILDER =================
// =====================================================

bot.action("prod_builder_start", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  setState(ctx.chat.id, {
    mode: "prod_builder",
    step: 0,
    data: defaultProductData(),
  });

  return askProductStep(ctx);
});

bot.action("prod_builder_cancel", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  clearState(ctx.chat.id);
  return ctx.reply("Ок, отменил.", mainMenu(ctx));
});

bot.action("prod_builder_back", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  st.step = Math.max(0, Number(st.step || 0) - 1);
  setState(ctx.chat.id, st);
  return askProductStep(ctx);
});

// CATEGORY
bot.action(/prod_set_category:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  st.data.categoryKey = String(ctx.match[1] || "");
  setState(ctx.chat.id, st);
  return nextProductStep(ctx);
});

// LAYOUT
bot.action(/prod_set_layout:(1|2)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  const id = Number(ctx.match[1]);
  const preset = PRODUCT_LAYOUTS.find((x) => x.id === id);
  if (!preset) return;

  st.data.classCardDuck = preset.value.classCardDuck;
  st.data.classActions = preset.value.classActions;

  setState(ctx.chat.id, st);
  return nextProductStep(ctx);
});

// BADGE
bot.action(/prod_set_badge:(NEW|SALE|NONE)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  const v = String(ctx.match[1]);
  if (v === "NONE") {
    st.data.newBadge = "";
    st.data.classNewBadge = "";
  } else {
    st.data.newBadge = v;
    // у тебя в карточках сейчас используется classNewBadge:"actionBadge sale"
    st.data.classNewBadge = "actionBadge sale";
  }

  setState(ctx.chat.id, st);
  return nextProductStep(ctx);
});

// IS ACTIVE
bot.action(/prod_set_isActive:(true|false)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  st.data.isActive = ctx.match[1] === "true";
  setState(ctx.chat.id, st);
  return nextProductStep(ctx);
});

// CONFIRM -> POST /admin/products
bot.action("prod_builder_confirm", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  try {
    // минимальная валидация
    if (!st.data.categoryKey) throw new Error("Не выбрана категория");
    if (!st.data.title1) throw new Error("Нет названия (строка 1)");
    if (!st.data.price || Number(st.data.price) <= 0) throw new Error("Цена должна быть больше 0");
    if (!st.data.cardBgUrl || !isValidUrl(st.data.cardBgUrl)) throw new Error("Неверная ссылка на фон");
    if (!st.data.cardDuckUrl || !isValidUrl(st.data.cardDuckUrl)) throw new Error("Неверная ссылка на утку");
    if (!st.data.orderImgUrl || !isValidUrl(st.data.orderImgUrl)) throw new Error("Неверная ссылка на картинку оформления");

    const payload = {
      categoryKey: st.data.categoryKey,

      title1: st.data.title1,
      title2: st.data.title2,
      titleModal: st.data.titleModal,
      price: Number(st.data.price || 0),

      cardBgUrl: st.data.cardBgUrl,
      cardDuckUrl: st.data.cardDuckUrl,
      orderImgUrl: st.data.orderImgUrl,

      classCardDuck: st.data.classCardDuck,
      classActions: st.data.classActions,

      classNewBadge: st.data.classNewBadge,
      newBadge: st.data.newBadge,

      accentColor: st.data.accentColor,

      sortOrder: Number(st.data.sortOrder || 0),
      isActive: st.data.isActive !== false,

      flavors: [], // вкусы добавим отдельным конструктором
    };

    const created = await api("/admin/products", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    clearState(ctx.chat.id);
    return ctx.reply(`✅ Товар создан: ${created?.product?.title1 || "OK"}`, mainMenu(ctx));
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

// ===== Text steps handler for product wizard =====
bot.on("text", async (ctx, next) => {
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return next();

  const step = PRODUCT_BUILDER_STEPS[st.step];
  const text = String(ctx.message?.text || "").trim();

  try {
    if (step === "titles") {
      const parts = text.split(",").map((s) => s.trim());
      if (parts.length < 2) throw new Error("Нужно 2 значения через запятую");

      st.data.title1 = parts[0] || "";
      st.data.title2 = parts[1] === "-" ? "" : (parts[1] || "");

      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    if (step === "price") {
      const n = Number(text.replace(/\s+/g, ""));
      if (!Number.isFinite(n) || n <= 0) throw new Error("Цена должна быть числом больше 0");

      st.data.price = n;
      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    if (step === "cardImages") {
      const parts = text.split(",").map((s) => s.trim());
      if (parts.length < 2) throw new Error("Нужно 2 ссылки через запятую");

      const bg = parts[0];
      const duck = parts[1];

      if (!isValidUrl(bg)) throw new Error("Ссылка на фон некорректная");
      if (!isValidUrl(duck)) throw new Error("Ссылка на утку некорректная");

      st.data.cardBgUrl = bg;
      st.data.cardDuckUrl = duck;

      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    if (step === "orderImage") {
      if (!isValidUrl(text)) throw new Error("Ссылка некорректная");
      st.data.orderImgUrl = text;

      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    if (step === "titleModal") {
      if (text.length < 2) throw new Error("Название слишком короткое");
      st.data.titleModal = text;

      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    if (step === "accentColor") {
      const m = text.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/);
      if (!m) throw new Error("Формат: 32, 130, 231");

      const r = Number(m[1]);
      const g = Number(m[2]);
      const b = Number(m[3]);

      if ([r, g, b].some((x) => x < 0 || x > 255)) throw new Error("RGB должен быть 0..255");

      st.data.accentColor = `${r}, ${g}, ${b}`;
      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    if (step === "sortOrder") {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) throw new Error("sortOrder должен быть числом 0+");

      st.data.sortOrder = n;
      setState(ctx.chat.id, st);
      return nextProductStep(ctx);
    }

    return next();
  } catch (e) {
    return ctx.reply(`❌ ${e.message}`);
  }
});

// =====================================================
// ================== FLAVOR BUILDER ACTIONS ============
// =====================================================

bot.action("fl_builder_start", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  setState(ctx.chat.id, {
    mode: "fl_builder",
    step: 0,
    data: defaultFlavorBuilderData(),
  });

  return askFlavorStep(ctx);
});

bot.action("fl_cancel", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  clearState(ctx.chat.id);
  return ctx.reply("Ок, отменил.", mainMenu(ctx));
});

bot.action("fl_back", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  st.step = Math.max(0, Number(st.step || 0) - 1);
  setState(ctx.chat.id, st);
  return askFlavorStep(ctx);
});

bot.action(/fl_pick_product:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const productId = String(ctx.match[1] || "");
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  // найдём title для превью
  const r = await fetch(`${API_URL}/products?active=0`);
  const data = await r.json().catch(() => ({}));
  const products = data.products || [];
  const prod = products.find((p) => String(p._id) === productId);

  st.data.productId = productId;
  st.data.productTitle = prod ? `${prod.title1 || ""} ${prod.title2 || ""}`.trim() : productId;

  setState(ctx.chat.id, st);
  return nextFlavorStep(ctx);
});

bot.action(/fl_set_mode:(new|stock)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  const mode = String(ctx.match[1]);
  st.data.mode = mode;

  // если new -> шаг newFlavor, если stock -> шаг pickFlavor
  st.step = mode === "new"
    ? FL_BUILDER_STEPS.indexOf("newFlavor")
    : FL_BUILDER_STEPS.indexOf("pickFlavor");

  setState(ctx.chat.id, st);
  return askFlavorStep(ctx);
});

bot.action(/fl_pick_flavor:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const flavorId = String(ctx.match[1] || "");
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  // подцепим label/gradient чтобы показывать в превью
  const r = await fetch(`${API_URL}/products?active=0`);
  const data = await r.json().catch(() => ({}));
  const products = data.products || [];
  const prod = products.find((p) => String(p._id) === String(st.data.productId));
  const fl = (prod?.flavors || []).find((f) => String(f._id) === flavorId);

  st.data.flavorId = flavorId;
  st.data.label = fl?.label || "";
  st.data.flavorKey = fl?.flavorKey || "";
  st.data.gradient = Array.isArray(fl?.gradient) ? fl.gradient : ["", ""];

  // дальше — точка
  st.step = FL_BUILDER_STEPS.indexOf("pickupPoint");
  setState(ctx.chat.id, st);
  return askFlavorStep(ctx);
});

bot.action(/fl_pick_point:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const id = String(ctx.match[1] || "");
  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  const points = await fetchMyPickupPoints(ctx);
  const p = points.find((x) => String(x._id) === id);

  st.data.pickupPointId = id;
  st.data.pickupPointLabel = p?.address || "—";

  // дальше qty
  st.step = FL_BUILDER_STEPS.indexOf("qty");
  setState(ctx.chat.id, st);
  return askFlavorStep(ctx);
});

bot.action("fl_confirm", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "fl_builder") return;

  try {
    const d = st.data;

    if (!d.productId) throw new Error("Не выбран товар");
    if (!d.pickupPointId) throw new Error("Не выбрана точка");
    if (!Number.isFinite(Number(d.totalQty)) || Number(d.totalQty) < 0) throw new Error("Некорректное количество");

    let flavorId = d.flavorId;

    // 1) если новый вкус — создаём вкус
    if (d.mode === "new") {
      if (!d.label) throw new Error("Нет названия вкуса");
      if (!isHex(d.gradient?.[0]) || !isHex(d.gradient?.[1])) throw new Error("Цвета должны быть #RRGGBB");

      const flavorKey = d.flavorKey || slugify(d.label);

      const created = await api(`/admin/products/${d.productId}/flavors`, {
        method: "POST",
        body: JSON.stringify({
          flavorKey,
          label: d.label,
          gradient: [d.gradient[0], d.gradient[1]],
          isActive: true,
        }),
      });

      const prod = created.product || created?.data?.product || created; // на всякий
      const found = (prod.flavors || []).find((f) => String(f.flavorKey) === String(flavorKey));
      if (!found?._id) throw new Error("Не смог найти созданный вкус в ответе сервера");
      flavorId = String(found._id);
    }

    if (!flavorId) throw new Error("Не выбран вкус");

    // 2) выставляем остаток по точке
    await api(`/admin/products/${d.productId}/flavors/${flavorId}/stock`, {
      method: "PATCH",
      body: JSON.stringify({
        pickupPointId: d.pickupPointId,
        totalQty: Number(d.totalQty),
        updatedByTelegramId: String(ctx.from?.id || ""),
      }),
    });

    clearState(ctx.chat.id);
    return ctx.reply("✅ Готово! Вкус/наличие сохранены.", mainMenu(ctx));
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// ==================== CATEGORY EDIT ===================

bot.action("cat_edit_start", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  try {
    const r = await fetch(`${API_URL}/categories?active=0`);
    const data = await r.json().catch(() => ({}));
    const categories = Array.isArray(data) ? data : data.categories || [];

    if (!categories.length) return ctx.reply("Категорий пока нет", mainMenu(ctx));

    return ctx.reply(
      "Выберите категорию для редактирования:",
      Markup.inlineKeyboard(
        categories.map((c) => [
          Markup.button.callback(
            `${c.isActive ? "✅" : "⛔️"} ${c.title}`,
            `cat_edit_pick:${c._id}`
          ),
        ])
      )
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action(/cat_edit_pick:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const id = ctx.match[1];

  const r = await fetch(`${API_URL}/categories?active=0`);
  const data = await r.json().catch(() => ({}));
  const categories = Array.isArray(data) ? data : data.categories || [];
  const cat = categories.find((c) => String(c._id) === String(id));

  if (!cat) return ctx.reply("Категория не найдена", mainMenu(ctx));

    setState(ctx.chat.id, {
    mode: "cat_edit_menu",
    editId: id,
    data: {
        key: cat.key || "",
        title: cat.title || "",
        badgeText: cat.badgeText || "",
        showOverlay: !!cat.showOverlay,
        classCardDuck: cat.classCardDuck || "cardImageLeft",
        titleClass: cat.titleClass || "cardTitle",
        cardBgUrl: cat.cardBgUrl || "",
        cardDuckUrl: cat.cardDuckUrl || "",
        sortOrder: cat.sortOrder || 0,
        isActive: cat.isActive !== false,
    },
    });

  return sendEditMenu(ctx);
});

bot.action("cat_edit_open_wizard", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  setState(ctx.chat.id, {
    mode: "cat_edit",
    step: 0,
    editId: st.editId,
    data: { ...st.data },
  });

  return askStep(ctx);
});

bot.action(/cat_builder_set_variant:(1|2|3|4)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  const id = Number(ctx.match[1]);
  const preset = CATEGORY_VARIANTS.find((v) => v.id === id);
  if (!preset) return;

  st.data.layoutVariant = id;
  st.data.classCardDuck = preset.value.classCardDuck;
  st.data.titleClass = preset.value.titleClass;
  st.data.showOverlay = preset.value.showOverlay;

  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

// SALE/NEW DROP + side
bot.action(/cat_builder_set_badge:(SALE|NEW DROP):(left|right)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  st.data.badgeText = ctx.match[1];
  st.data.badgeSide = ctx.match[2] === "right" ? "right" : "left";

  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

// NONE
bot.action("cat_builder_set_badge:NONE", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  st.data.badgeText = "";
  st.data.badgeSide = "left";

  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

bot.action("cat_edit_toggle_isActive", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  const nextVal = !st.data.isActive;

  try {
    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: nextVal }),
    });

    st.data.isActive = updated.category.isActive !== false;
    setState(ctx.chat.id, st);
    return sendEditMenu(ctx);
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action("cat_edit_toggle_overlay", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  const nextVal = !st.data.showOverlay;

  try {
    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify({ showOverlay: nextVal }),
    });

    st.data.showOverlay = !!updated.category.showOverlay;
    setState(ctx.chat.id, st);
    return sendEditMenu(ctx);
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action(/cat_edit_prompt:(key|title|badgeText|cardBgUrl|cardDuckUrl|sortOrder)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  const field = ctx.match[1];
  setState(ctx.chat.id, { ...st, mode: "cat_edit_prompt", field });

  const prompts = {
    key: "Введите новый *key* (a-z/0-9/-, 2-32) или `-` чтобы отменить",
    title: "Введите новый *title* или `-` чтобы отменить",
    badgeText: "Введите новый *badgeText* (или `-` чтобы отменить)",
    cardBgUrl: "Вставьте новый *cardBgUrl* (https://...) или `-` чтобы отменить",
    cardDuckUrl: "Вставьте новый *cardDuckUrl* (https://...) или `-` чтобы отменить",
    sortOrder: "Введите новый *sortOrder* (число) или `-` чтобы отменить",
  };

  return ctx.reply(prompts[field], { parse_mode: "Markdown" });
});

bot.action("cat_edit_pick_classDuck", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  return ctx.reply(
    "Выберите classCardDuck:",
    Markup.inlineKeyboard([
      ...DUCK_CLASS_OPTIONS.map((o) => [Markup.button.callback(o.label, `cat_edit_set_classDuck:${o.value}`)]),
      [Markup.button.callback("⬅️ Назад", "cat_edit_back_to_menu")],
    ])
  );
});

bot.action(/cat_edit_set_classDuck:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  const val = ctx.match[1];
  const nextVal = DUCK_CLASS_OPTIONS.some((o) => o.value === val) ? val : "cardImageLeft";

  try {
    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify({ classCardDuck: nextVal }),
    });

    st.data.classCardDuck = updated.category.classCardDuck || nextVal;
    setState(ctx.chat.id, st);
    return sendEditMenu(ctx);
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action("cat_edit_pick_titleClass", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  return ctx.reply(
    "Выберите titleClass:",
    Markup.inlineKeyboard([
      ...TITLE_CLASS_OPTIONS.map((o) => [Markup.button.callback(o.label, `cat_edit_set_titleClass:${o.value}`)]),
      [Markup.button.callback("⬅️ Назад", "cat_edit_back_to_menu")],
    ])
  );
});

bot.action(/cat_edit_set_titleClass:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit_menu") return;

  const val = ctx.match[1];
  const nextVal = TITLE_CLASS_OPTIONS.some((o) => o.value === val) ? val : "cardTitle";

  try {
    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify({ titleClass: nextVal }),
    });

    st.data.titleClass = updated.category.titleClass || nextVal;
    setState(ctx.chat.id, st);
    return sendEditMenu(ctx);
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action("cat_edit_back_to_menu", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();
  return sendEditMenu(ctx);
});

// =====================================================
// ==================== CATEGORY LIST ===================
// =====================================================
bot.action("cat_list", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  try {
    const r = await fetch(`${API_URL}/categories?active=0`);
    const data = await r.json().catch(() => ({}));
    const categories = Array.isArray(data) ? data : data.categories || [];

    if (!categories.length) return ctx.reply("Категорий пока нет", mainMenu(ctx));

    const msg = categories
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => `${c.isActive ? "✅" : "⛔️"} ${c.title} (${c.key})`)
      .join("\n");

    return ctx.reply(msg, mainMenu(ctx));
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

// =====================================================
// ============ CATEGORY BUILDER (FULL WIZARD) ===========
// =====================================================
bot.action("cat_builder_start", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  setState(ctx.chat.id, { mode: "cat_builder", step: 0, data: defaultCategoryData() });
  return askStep(ctx);
});

bot.action("cat_builder_cancel", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  clearState(ctx.chat.id);
  return ctx.reply("Ок, отменено.", mainMenu(ctx));
});

bot.action("cat_builder_back", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  st.step = Math.max(0, st.step - 1);
  setState(ctx.chat.id, st);
  return askStep(ctx);
});

// ----- button setters -----
bot.action(/cat_builder_set_showOverlay:(true|false)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  st.data.showOverlay = ctx.match[1] === "true";
  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

bot.action(/cat_builder_set_classCardDuck:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  const val = ctx.match[1];
  st.data.classCardDuck = DUCK_CLASS_OPTIONS.some((o) => o.value === val) ? val : "cardImageLeft";
  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

bot.action(/cat_builder_set_titleClass:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  const val = ctx.match[1];
  st.data.titleClass = TITLE_CLASS_OPTIONS.some((o) => o.value === val) ? val : "cardTitle";
  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

bot.action(/cat_builder_set_isActive:(true|false)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  st.data.isActive = ctx.match[1] === "true";
  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

// ----- confirm create -----
bot.action("cat_builder_confirm", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_builder") return;

  try {
    const payload = { ...st.data };

    const created = await api("/admin/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    clearState(ctx.chat.id);
    return ctx.reply(
      `✅ Категория создана:\n${created.category.title} (${created.category.key})`,
      mainMenu(ctx)
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action("cat_edit_confirm", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "cat_edit") return;

  try {
    const payload = { ...st.data };

    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    clearState(ctx.chat.id);

    return ctx.reply(
      `✅ Категория обновлена:\n${updated.category.title} (${updated.category.key})`,
      mainMenu(ctx)
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
  }
});

bot.action(/prod_set_layout:(1|2)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  const id = Number(ctx.match[1]);
  const preset = PRODUCT_LAYOUTS.find((x) => x.id === id);
  if (!preset) return;

  st.data.classCardDuck = preset.value.classCardDuck;
  st.data.classActions = preset.value.classActions;

  setState(ctx.chat.id, st);
  return nextProductStep(ctx);
});

bot.action(/prod_set_category:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || st.mode !== "prod_builder") return;

  st.data.categoryKey = ctx.match[1];
  setState(ctx.chat.id, st);
  return nextProductStep(ctx);
});

// ----- text inputs for steps -----
bot.on("text", async (ctx) => {
  if (!isAdmin(ctx)) return;

    if (ctx.message?.message_id) {
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch {}
    }

    const st = getState(ctx.chat.id);
    if (!st) return;

    if (st?.mode === "cashback_grant") {
      const step = CASHBACK_GRANT_STEPS[st.step];
      const text = String(ctx.message?.text || "").trim();
        if (text.startsWith("/")) return;

      if (step === "username") {
        const username = text.replace(/^@+/, "").trim();
        if (!username || username.includes(" ")) {
          return ctx.reply("❌ Введи username в формате @username или username без пробелов.");
        }

        st.data.username = `@${username}`;
        st.step = 1;
        setState(ctx.chat.id, st);
        return askCashbackGrantStep(ctx);
      }

      if (step === "amount") {
        const normalized = text.replace(",", ".");
        const amountZl = Number(normalized);
        if (!Number.isFinite(amountZl) || amountZl <= 0) {
          return ctx.reply("❌ Введи корректную сумму больше 0. Пример: 25 или 37.5");
        }

        st.data.amountZl = Number(amountZl.toFixed(2));
        st.step = 2;
        setState(ctx.chat.id, st);
        return askCashbackGrantStep(ctx);
      }
    }

    // ===== pickup points: create wizard =====
    if (st.mode === "pp_create") {
      const text = String(ctx.message.text || "").trim();
      const step = Number(st.step || 0);

      try {
        if (step === 0) {
          const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length < 2) return ctx.reply("❌ Формат неверный. Нужно: название, адрес");

          st.data.title = parts[0] || "";
          st.data.address = parts.slice(1).join(", ");
          setState(ctx.chat.id, st);
          return nextPickupCreateStep(ctx);
        }

        if (step === 1) {
          if (text === "-" || text.toLowerCase() === "нет") {
            st.data.allowedAdminTelegramIds = [];
          } else {
            const ids = text.split(",").map((s) => s.trim()).filter(Boolean);
            const bad = ids.find((x) => !/^\d+$/.test(x));
            if (bad) return ctx.reply("❌ ID менеджера должен быть числом (telegramId). Пример: 123456789");
            st.data.allowedAdminTelegramIds = ids;
          }

          setState(ctx.chat.id, st);
          return nextPickupCreateStep(ctx);
        }

        return ctx.reply("❌ Неожиданный шаг. Нажми Отмена и попробуй снова.");
      } catch (e) {
        return ctx.reply(`❌ ${e.message}`);
      }
    }

    // ===== Text handler for FLAVOR BUILDER =====
    if (st && st.mode === "fl_builder") {
      const step = FL_BUILDER_STEPS[st.step];
      const text = String(ctx.message?.text || "").trim();

      try {
        // new flavor input: "label, #HEX1, #HEX2"
        if (step === "newFlavor") {
          const parts = text.split(",").map((s) => s.trim());
          if (parts.length < 3) throw new Error("Нужно: название, #ЦВЕТ1, #ЦВЕТ2");

          const label = parts[0];
          const c1 = parts[1];
          const c2 = parts[2];

          if (label.length < 2) throw new Error("Слишком короткое название вкуса");
          if (!isHex(c1) || !isHex(c2)) throw new Error("Цвета должны быть в формате #RRGGBB");

          st.data.label = label;
          st.data.gradient = [c1, c2];
          st.data.flavorKey = slugify(label);

          // дальше — выбор точки
          st.step = FL_BUILDER_STEPS.indexOf("pickupPoint");
          setState(ctx.chat.id, st);
          return askFlavorStep(ctx);
        }

        // qty
        if (step === "qty") {
          const n = Number(text.replace(/\s+/g, ""));
          if (!Number.isFinite(n) || n < 0) throw new Error("Количество должно быть числом 0+");

          st.data.totalQty = n;
          st.step = FL_BUILDER_STEPS.indexOf("confirm");
          setState(ctx.chat.id, st);
          return askFlavorStep(ctx);
        }

        return next?.();
      } catch (e) {
        return ctx.reply(`❌ ${e.message}`);
      }
    }

    if (st.mode === "pp_payment_prompt") {
      try {
        const text = String(ctx.message?.text || "").trim();
        const [labelRaw, detailsRaw, badgeRaw, activeRaw] = text
          .split("|")
          .map((x) => String(x || "").trim());

        if (!labelRaw) {
          return ctx.reply("❌ Укажите label в формате: label | detailsValue | badge | on/off");
        }

        const data = await api(`/pickup-points?active=0`);
        const points = data.pickupPoints || [];
        const point = points.find((x) => String(x._id) === String(st.pointId));

        if (!point) {
          clearState(ctx.chat.id);
          return ctx.reply("❌ Точка не найдена", mainMenu(ctx));
        }

        const methods = Array.isArray(point?.paymentConfig?.methods)
          ? [...point.paymentConfig.methods]
          : [];

        const idx = methods.findIndex(
          (m) => String(m?.key || "") === String(st.methodKey)
        );

        const nextMethod = {
          key: st.methodKey,
          label: labelRaw,
          detailsValue: detailsRaw || "",
          badge: badgeRaw || "",
          isActive: String(activeRaw || "on").toLowerCase() !== "off",
        };

        if (idx >= 0) methods[idx] = nextMethod;
        else methods.push(nextMethod);

        await api(`/admin/pickup-points/${st.pointId}`, {
          method: "PATCH",
          body: JSON.stringify({
            paymentConfig: { methods },
          }),
        });

        const refreshed = await api(`/pickup-points?active=0`);
        const updatedPoint = (refreshed.pickupPoints || []).find(
          (x) => String(x._id) === String(st.pointId)
        );

        clearState(ctx.chat.id);

        return ctx.reply(renderPickupPointPreview(updatedPoint), {
          parse_mode: "Markdown",
          ...ppMenuKeyboard(updatedPoint._id),
        });
      } catch (e) {
        console.error(e);
        return ctx.reply(`❌ Ошибка: ${e.message}`);
      }
    }

    // ===== pickup points: prompt edit =====
    if (st.mode === "pp_prompt") {
      const text = String(ctx.message.text || "").trim();

      // cancel
      if (text === "-") {
        clearState(ctx.chat.id);
        return ctx.reply(
          "Ок.",
          Markup.inlineKeyboard([
            [Markup.button.callback("🏪 К списку точек", "pp_list")],
            [Markup.button.callback("🏠 Меню", "cat_builder_cancel")],
          ])
        );
      }

      const field = st.field;
      const id = st.ppId;

      try {
        const patch = {};

        if (field === "title") patch.title = text;
        if (field === "address") patch.address = text;

        if (field === "sortOrder") {
          const n = Number(text);
          if (!Number.isFinite(n) || n < 0) return ctx.reply("❌ sortOrder должен быть числом 0+");
          patch.sortOrder = n;
        }

        if (field === "allowedAdminTelegramIds") {
          const ids = text.split(",").map((s) => s.trim()).filter(Boolean);
          const bad = ids.find((x) => !/^\d+$/.test(x));
          if (bad) return ctx.reply("❌ ID менеджера должен быть числом (telegramId). Пример: 123456789");
          patch.allowedAdminTelegramIds = ids;
        }

        if (field === "notificationChatId" || field === "statsChatId") {
          patch[field] = String(text || "").trim();
        }

        const updated = await api(`/admin/pickup-points/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });

        const fresh = updated?.pickupPoint || updated;
        setState(ctx.chat.id, { mode: "pp_open", ppId: id, data: fresh });

        return ctx.reply(renderPickupPointPreview(fresh), {
          parse_mode: "Markdown",
          reply_markup: (isSuperAdmin(ctx)
            ? ppMenuKeyboard(id)
            : pickupPointManagerMenu(id, { isSuper: false })
          ).reply_markup,
        });
      } catch (e) {
        return ctx.reply(`❌ Ошибка: ${e.message}`);
      }
    }

    if (st?.mode === "pp_prompt_today_schedule") {
      const text = String(ctx.message.text || "").trim();
      const pickupPointId = String(st.pickupPointId || "").trim();

      if (!pickupPointId) {
        clearState(ctx.chat.id);
        return ctx.reply("❌ Точка не найдена.");
      }

      const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      let scheduleValue = null;

      if (text.toLowerCase() === "выходной") {
        scheduleValue = {
          isOpen: false,
          from: "",
          to: "",
          note: "выходной",
        };
      } else {
        const m = text.match(/^([0-2]\d):([0-5]\d)\s*-\s*([0-2]\d):([0-5]\d)$/);

        if (!m) {
          return ctx.reply(
            "❌ Неверный формат.\n\n" +
              "Используй:\n" +
              "`10:00-22:00`\n\n" +
              "или\n\n" +
              "`выходной`",
            { parse_mode: "Markdown" }
          );
        }

        const from = `${m[1]}:${m[2]}`;
        const to = `${m[3]}:${m[4]}`;

        scheduleValue = {
          isOpen: true,
          from,
          to,
          note: "",
        };
      }

      try {
        await api(`/admin/pickup-points/${pickupPointId}`, {
          method: "PATCH",
          body: JSON.stringify({
            scheduleByDatePatch: {
              [todayKey]: scheduleValue,
            },
          }),
        });

        clearState(ctx.chat.id);

        await ctx.reply(
          `✅ График на сегодня сохранён:\n\n${todayKey}\n${
            scheduleValue.isOpen
              ? `${scheduleValue.from}-${scheduleValue.to}`
              : "выходной"
          }`
        );

        const pointData = await api(`/pickup-points?active=0`);
        const points = Array.isArray(pointData?.pickupPoints) ? pointData.pickupPoints : [];
        const point = points.find((x) => String(x?._id) === String(pickupPointId));

        if (point) {
          return ctx.replyWithMarkdown(
            renderPickupPointPreview(point),
            ppMenuKeyboard(point._id)
          );
        }

        return ctx.reply("Ок.", mainMenu(ctx));
      } catch (e) {
        return ctx.reply(`❌ Ошибка: ${e.message}`);
      }
    }

    // ===== quick edit prompt inputs =====
    if (st.mode === "cat_edit_prompt") {
    const field = st.field;
    const text = String(ctx.message.text || "").trim();

    // cancel/back
    if (text === "-") {
        setState(ctx.chat.id, { ...st, mode: "cat_edit_menu" });
        return sendEditMenu(ctx);
    }

    const patch = {};

    if (field === "key") {
        if (!isValidKey(text)) {
        return ctx.reply("❌ Неверный key. Формат: a-z, 0-9, дефис. 2-32 символа.");
        }
        patch.key = text;
    }

    if (field === "title") {
        if (text.length < 2) return ctx.reply("❌ Слишком короткий title");
        patch.title = text;
    }

    if (field === "badgeText") {
        patch.badgeText = text;
    }

    if (field === "cardBgUrl") {
        if (!isValidUrl(text)) return ctx.reply("❌ Вставь нормальный URL (https://...)");
        patch.cardBgUrl = text;
    }

    if (field === "cardDuckUrl") {
        if (!isValidUrl(text)) return ctx.reply("❌ Вставь нормальный URL (https://...)");
        patch.cardDuckUrl = text;
    }

    if (field === "sortOrder") {
        const n = Number(text);
        if (Number.isNaN(n)) return ctx.reply("❌ sortOrder должен быть числом (0,1,2...)");
        patch.sortOrder = n;
    }

    try {
        const updated = await api(`/admin/categories/${st.editId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
        });

        setState(ctx.chat.id, {
        mode: "cat_edit_menu",
        editId: st.editId,
        data: {
            key: updated.category.key || "",
            title: updated.category.title || "",
            badgeText: updated.category.badgeText || "",
            showOverlay: !!updated.category.showOverlay,
            classCardDuck: updated.category.classCardDuck || "cardImageLeft",
            titleClass: updated.category.titleClass || "cardTitle",
            cardBgUrl: updated.category.cardBgUrl || "",
            cardDuckUrl: updated.category.cardDuckUrl || "",
            sortOrder: updated.category.sortOrder || 0,
            isActive: updated.category.isActive !== false,
        },
        });

        return sendEditMenu(ctx);
    } catch (e) {
        return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu(ctx));
    }
    }

    // ===== wizard inputs (старое поведение) =====
    if (st.mode !== "cat_builder" && st.mode !== "cat_edit") return;

    const step = BUILDER_STEPS[st.step];
    const text = String(ctx.message.text || "").trim();

  if (step === "assetsAndTitle") {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length < 3) {
    return ctx.reply("❌ Формат неверный. Нужно так: ссылка_на_фон, ссылка_на_утку, название категории");
  }

  const bg = parts[0];
  const duck = parts[1];
  const title = parts.slice(2).join(", ");

  if (!isValidUrl(bg)) return ctx.reply("❌ Первая часть должна быть ссылкой на фон (https://...)");
  if (!isValidUrl(duck)) return ctx.reply("❌ Вторая часть должна быть ссылкой на утку (https://...)");
  if (title.length < 2) return ctx.reply("❌ Слишком короткое название категории");

  st.data.cardBgUrl = bg;
  st.data.cardDuckUrl = duck;
  st.data.title = title;

  if (!st.data.key) {
    st.data.key = translitRuToLat(st.data.title);
  }

  setState(ctx.chat.id, st);
  return nextStep(ctx);
}

  // sortOrder
  if (step === "sortOrder") {
    const n = Number(text);
    if (Number.isNaN(n)) return ctx.reply("❌ sortOrder должен быть числом (0,1,2...)");
    st.data.sortOrder = n;
    setState(ctx.chat.id, st);
    return nextStep(ctx);
  }
});

// =====================================================
// ===================== BOT START ======================
// =====================================================
bot.launch().then(() => console.log("✅ Admin bot launched")); 