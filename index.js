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

const isValidKey = (s) => /^[a-z0-9-]{2,32}$/.test(s);
const isValidUrl = (s) => /^https?:\/\/\S+$/i.test(s);

// =====================================================
// ====================== UI MENU =======================
// =====================================================
const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("➕ Создать категорию (конструктор)", "cat_builder_start")],
    [Markup.button.callback("✏️ Редактировать категорию", "cat_edit_start")],
    [Markup.button.callback("📋 Список категорий", "cat_list")],
  ]);

// =====================================================
// ===================== BOT STATE ======================
// =====================================================
const state = new Map(); // chatId -> { mode, step, data }
const getState = (chatId) => state.get(String(chatId));
const setState = (chatId, st) => state.set(String(chatId), st);
const clearState = (chatId) => state.delete(String(chatId));

// =====================================================
// =================== CATEGORY BUILDER =================
// =====================================================

// ----- Builder steps order -----
const BUILDER_STEPS = [
  "key",
  "title",
  "badgeText",
  "showOverlay",
  "classCardDuck",
  "titleClass",
  "cardBgUrl",
  "cardDuckUrl",
  "sortOrder",
  "isActive",
  "confirm",
];

// ===== Step images (Pinata) =====
const CAT_STEP_IMAGES = {
  key: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafkreifg2pygkq5phcldy6maw36lcxv56my5bjebxwjrqdqbzlsnyyn3qq",
  title: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeieybamq3arkrfiq2r7xpzomjdusk4meyunyalfg44pjrh5yjrecty",
  badgeText: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeidjfskuf4rdoerl3blkkcvlcz5u5nzibxrqs2mjl7axjen65xbdhm",
  showOverlay: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeihyokn353keqwufizwwvxlviqcw2njrox4n72pgtlhhbphon64ydu",
  classCardDuck: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeiek577kz4w4iquo2gskyobzd34cuaxxv6ztqcrcf25z345ezdm6e4",
  titleClass: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeibpayzmjfpkqak6ytkcnhishguq3fq3qf6bdjblmbl2pka2y7v6sq",
  cardBgUrl: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeigccmktm2i5f2g6ves3l754jkz3wn6auxclqarcra33uautb67nii",
  cardDuckUrl: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeigvoryk67aa3hhlslovtwai3q6evzs2vakd2oaudif6qsu4xz4mqq",
  sortOrder: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeiaectbg64b5iud6p3thvqmciwusne4xvn2woosyso3cgqruoqx3wy",
  isActive: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafybeibqdkr5tk6ozooh4lngx37coih63v7m2ufrspimstxccxbcuqfzke",
  confirm: "https://blush-impressive-moth-462.mypinata.cloud/ipfs/bafkreiembjot7lxn3lvjwkjc5nswqizgldije3hrib2jy5hdxkgtfnzh7q",
};

// ===== Send ONE message: photo + caption + keyboard (or text fallback) =====
const sendStepCard = async (ctx, { photoUrl, caption, keyboard }) => {
  if (photoUrl && isValidUrl(photoUrl)) {
    // caption у Telegram ограничен ~1024 символами
    return ctx.replyWithPhoto(
      { url: photoUrl },
      {
        caption,
        parse_mode: "Markdown",
        ...(keyboard ? keyboard : {}),
      }
    );
  }

  return ctx.reply(caption, {
    parse_mode: "Markdown",
    ...(keyboard ? keyboard : {}),
  });
};

// ----- defaults for new category -----
const defaultCategoryData = () => ({
  key: "",
  title: "",
  badgeText: "",
  showOverlay: false,
  classCardDuck: "cardImageLeft",
  titleClass: "cardTitle",
  cardBgUrl: "",
  cardDuckUrl: "",
  sortOrder: 0,
  isActive: true,
});

// ----- available UI classes (you can expand anytime) -----
const DUCK_CLASSES = [
  "высота 95%, слева",
  "высота 60%, справа",
  "высота 60%, слева",
  "высота 95%, справа",
];

const TITLE_CLASSES = ["сверху", "по центру"];

// ----- render preview text -----
const renderCategoryPreview = (d) => {
  const lines = [];
  lines.push("🧩 *Конструктор категории — превью*");
  lines.push("");
  lines.push(`• key: \`${d.key || "—"}\``);
  lines.push(`• title: *${d.title || "—"}*`);
  lines.push(`• badgeText: ${d.badgeText ? `*${d.badgeText}*` : "—"}`);
  lines.push(`• showOverlay: *${d.showOverlay ? "true" : "false"}*`);
  lines.push(`• classCardDuck: \`${d.classCardDuck}\``);
  lines.push(`• titleClass: \`${d.titleClass}\``);
  lines.push(`• cardBgUrl: ${d.cardBgUrl || "—"}`);
  lines.push(`• cardDuckUrl: ${d.cardDuckUrl || "—"}`);
  lines.push(`• sortOrder: *${d.sortOrder}*`);
  lines.push(`• isActive: *${d.isActive ? "true" : "false"}*`);
  return lines.join("\n");
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
  lines.push(`• classCardDuck: \`${d.classCardDuck || "—"}\``);
  lines.push(`• titleClass: \`${d.titleClass || "—"}\``);
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

  if (step === "key") {
    question = "Введите *key* категории (латиница/цифры/дефис), пример: `liquids` или `disposables`";
  } else if (step === "title") {
    question = "Введите *title* (как на карточке), пример: `ЖИДКОСТИ`";
  } else if (step === "badgeText") {
    question = "Введите *badgeText* (например `NEW DROP`) или отправьте `-` чтобы оставить пустым";
  } else if (step === "cardBgUrl") {
    question = "Вставьте *фон карточки* (Pinata URL) или `-` чтобы пропустить";
  } else if (step === "cardDuckUrl") {
    question = "Вставьте *утку* (Pinata URL) или `-` чтобы пропустить";
  } else if (step === "sortOrder") {
    question = "Введите *порядок в сетке* (0,1,2...)";
  } else if (step === "confirm") {
    const isEdit = st?.mode === "cat_edit";
    question = isEdit ? "Подтвердить обновление категории?" : "Подтвердить создание категории?";
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

  // Для кнопочных шагов — тоже можно сделать 1 сообщение:
  if (step === "showOverlay") {
    const caption = `${preview}\n\nНужно ли затемнение (overlay)?`;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Да", "cat_builder_set_showOverlay:true")],
      [Markup.button.callback("❌ Нет", "cat_builder_set_showOverlay:false")],
      [Markup.button.callback("⬅️ Назад", "cat_builder_back"), Markup.button.callback("✖️ Отмена", "cat_builder_cancel")],
    ]);
    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES[step], caption, keyboard: kb });
  }

  if (step === "classCardDuck") {
    const caption = `${preview}\n\nВыберите позицию/класс утки:`;
    const kb = Markup.inlineKeyboard([
      ...DUCK_CLASSES.map((c) => [Markup.button.callback(c, `cat_builder_set_classCardDuck:${c}`)]),
      [Markup.button.callback("⬅️ Назад", "cat_builder_back"), Markup.button.callback("✖️ Отмена", "cat_builder_cancel")],
    ]);
    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES[step], caption, keyboard: kb });
  }

  if (step === "titleClass") {
    const caption = `${preview}\n\nВыберите стиль заголовка:`;
    const kb = Markup.inlineKeyboard([
      ...TITLE_CLASSES.map((c) => [Markup.button.callback(c, `cat_builder_set_titleClass:${c}`)]),
      [Markup.button.callback("⬅️ Назад", "cat_builder_back"), Markup.button.callback("✖️ Отмена", "cat_builder_cancel")],
    ]);
    return sendStepCard(ctx, { photoUrl: CAT_STEP_IMAGES[step], caption, keyboard: kb });
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
bot.start(async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("⛔️ Нет доступа");
  clearState(ctx.chat.id);
  return ctx.reply("🛠️ ELF DUCK — Admin Panel", mainMenu());
});

// ==================== CATEGORY EDIT ===================

bot.action("cat_edit_start", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  try {
    const r = await fetch(`${API_URL}/categories?active=0`);
    const data = await r.json().catch(() => ({}));
    const categories = Array.isArray(data) ? data : data.categories || [];

    if (!categories.length) return ctx.reply("Категорий пока нет", mainMenu());

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
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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

  if (!cat) return ctx.reply("Категория не найдена", mainMenu());

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
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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
      ...DUCK_CLASSES.map((c) => [Markup.button.callback(c, `cat_edit_set_classDuck:${c}`)]),
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
  const nextVal = DUCK_CLASSES.includes(val) ? val : "cardImageLeft";

  try {
    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify({ classCardDuck: nextVal }),
    });

    st.data.classCardDuck = updated.category.classCardDuck || nextVal;
    setState(ctx.chat.id, st);
    return sendEditMenu(ctx);
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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
      ...TITLE_CLASSES.map((c) => [Markup.button.callback(c, `cat_edit_set_titleClass:${c}`)]),
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
  const nextVal = TITLE_CLASSES.includes(val) ? val : "cardTitle";

  try {
    const updated = await api(`/admin/categories/${st.editId}`, {
      method: "PATCH",
      body: JSON.stringify({ titleClass: nextVal }),
    });

    st.data.titleClass = updated.category.titleClass || nextVal;
    setState(ctx.chat.id, st);
    return sendEditMenu(ctx);
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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

    if (!categories.length) return ctx.reply("Категорий пока нет", mainMenu());

    const msg = categories
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => `${c.isActive ? "✅" : "⛔️"} ${c.title} (${c.key})`)
      .join("\n");

    return ctx.reply(msg, mainMenu());
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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
  return ctx.reply("Ок, отменено.", mainMenu());
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
  st.data.classCardDuck = DUCK_CLASSES.includes(val) ? val : "cardImageLeft";
  setState(ctx.chat.id, st);
  return nextStep(ctx);
});

bot.action(/cat_builder_set_titleClass:(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("No access");
  await ctx.answerCbQuery();

  const st = getState(ctx.chat.id);
  if (!st || (st.mode !== "cat_builder" && st.mode !== "cat_edit")) return;

  const val = ctx.match[1];
  st.data.titleClass = TITLE_CLASSES.includes(val) ? val : "cardTitle";
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
      mainMenu()
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
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
      mainMenu()
    );
  } catch (e) {
    return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
  }
});

// ----- text inputs for steps -----
bot.on("text", async (ctx) => {
  if (!isAdmin(ctx)) return;

    const st = getState(ctx.chat.id);
    if (!st) return;

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
        return ctx.reply(`❌ Ошибка: ${e.message}`, mainMenu());
    }
    }

    // ===== wizard inputs (старое поведение) =====
    if (st.mode !== "cat_builder" && st.mode !== "cat_edit") return;

    const step = BUILDER_STEPS[st.step];
    const text = String(ctx.message.text || "").trim();

  // key
  if (step === "key") {
    if (!isValidKey(text)) {
      return ctx.reply("❌ Неверный key. Формат: a-z, 0-9, дефис. 2-32 символа. Пример: liquids");
    }
    st.data.key = text;
    setState(ctx.chat.id, st);
    return nextStep(ctx);
  }

  // title
  if (step === "title") {
    if (text.length < 2) return ctx.reply("❌ Слишком короткий title");
    st.data.title = text;
    setState(ctx.chat.id, st);
    return nextStep(ctx);
  }

  // badgeText
  if (step === "badgeText") {
    st.data.badgeText = text === "-" ? "" : text;
    setState(ctx.chat.id, st);
    return nextStep(ctx);
  }

  // cardBgUrl
  if (step === "cardBgUrl") {
    if (text !== "-" && !isValidUrl(text)) return ctx.reply("❌ Вставь нормальный URL (https://...) или `-`");
    st.data.cardBgUrl = text === "-" ? "" : text;
    setState(ctx.chat.id, st);
    return nextStep(ctx);
  }

  // cardDuckUrl
  if (step === "cardDuckUrl") {
    if (text !== "-" && !isValidUrl(text)) return ctx.reply("❌ Вставь нормальный URL (https://...) или `-`");
    st.data.cardDuckUrl = text === "-" ? "" : text;
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