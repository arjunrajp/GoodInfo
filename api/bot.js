// --- LOAD LIBRARIES ---
require('dotenv').config(); // For loading environment variables locally
const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// --- CORE BOT CONFIGURATION ---
const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const CHANNEL_USERNAME = "@ToxicBack2025";
const ADMIN_IDS = [7392785352]; // Make sure this is a number, not a string
const SUPPORT_ADMIN = "@CDMAXX";

// --- CONSTANTS ---
const INITIAL_CREDITS = 2;
const REFERRAL_CREDIT = 1;

// --- DATABASE SETUP ---
if (!TOKEN || !MONGO_URI) {
    console.error("FATAL ERROR: BOT_TOKEN or MONGO_URI is not set in environment variables!");
    process.exit(1);
}
const client = new MongoClient(MONGO_URI);
const db = client.db("ToxicBotDB");
const usersCollection = db.collection("users");
console.log("Attempting to connect to MongoDB...");
client.connect().then(() => console.log("MongoDB connected successfully!")).catch(err => console.error("MongoDB connection failed:", err));


// --- BOT INITIALIZATION ---
const bot = new Telegraf(TOKEN);


// --- MIDDLEWARE: FORCE CHANNEL JOIN ---
bot.use(async (ctx, next) => {
    const userId = ctx.from.id;
    if (ADMIN_IDS.includes(userId)) {
        return next(); // Admins are exempt
    }
    try {
        const chatMember = await ctx.telegram.getChatMember(CHANNEL_USERNAME, userId);
        if (!['member', 'administrator', 'creator'].includes(chatMember.status)) {
            await ctx.reply(`❗️ **Access Denied**\n\nTo use this bot, you must join our official channel.\nPlease join 👉 ${CHANNEL_USERNAME} and then press /start.`, { parse_mode: 'HTML' });
            return;
        }
    } catch (error) {
        console.error("Error checking channel membership:", error);
        await ctx.reply("⛔️ Error verifying channel membership. Please contact support.");
        return;
    }
    return next();
});


// --- HELPER FUNCTION: GET MAIN KEYBOARD ---
const getMainMenuKeyboard = (userId) => {
    const keyboard = [
        [Markup.button.text("Refer & Earn 🎁"), Markup.button.text("Buy Credits 💰")],
        [Markup.button.text("My Account 📊"), Markup.button.text("Help ❓")]
    ];
    if (ADMIN_IDS.includes(userId)) {
        keyboard.push(
            [Markup.button.text("Add Credit 👤"), Markup.button.text("Broadcast 📢")],
            [Markup.button.text("Member Status 👥")]
        );
    }
    return Markup.keyboard(keyboard).resize();
};

// --- HELPER FUNCTION: FORMAT REAL DATA ---
const formatRealRecordAsMessage = (record, index, total) => {
    const rawAddress = record.address || 'N/A';
    const cleanedParts = rawAddress.replace(/!!/g, '!').split('!').map(p => p.trim()).filter(Boolean);
    const formattedAddress = cleanedParts.join(', ');
    return `📊 *Record ${index + 1} of ${total}*\n` +
           `➖➖➖➖➖➖➖➖➖➖\n` +
           `👤 *Name:* \`${record.name || 'N/A'}\`\n` +
           `👨 *Father's Name:* \`${record.fname || 'N/A'}\`\n` +
           `📱 *Mobile:* \`${record.mobile || 'N/A'}\`\n` +
           `🏠 *Address:* \`${formattedAddress}\`\n` +
           `📡 *Circle:* \`${record.circle || 'N/A'}\``;
};

// --- COMMAND HANDLERS ---
bot.start(async (ctx) => {
    const user = ctx.from;
    const userId = user.id;

    let userDoc = await usersCollection.findOne({ _id: userId });

    if (!userDoc) {
        // Handle referral
        const startPayload = ctx.startPayload;
        if (startPayload) {
            const referrerId = parseInt(startPayload, 10);
            if (!isNaN(referrerId) && referrerId !== userId) {
                const referrerDoc = await usersCollection.findOne({ _id: referrerId });
                if (referrerDoc) {
                    await usersCollection.updateOne({ _id: referrerId }, { $inc: { credits: REFERRAL_CREDIT } });
                    const newBalance = (referrerDoc.credits || 0) + REFERRAL_CREDIT;
                    try {
                        await ctx.telegram.sendMessage(referrerId, `🎉 *1 Referral Received!*\nYour new balance is now *${newBalance} credits*.`, { parse_mode: 'Markdown' });
                    } catch (e) { console.error(`Failed to notify referrer ${referrerId}:`, e); }
                }
            }
        }
        
        // Notify admins
        let adminNotification = `🎉 New Member Alert!\n\nName: ${user.first_name}\nProfile: [${userId}](tg://user?id=${userId})`;
        if (user.username) adminNotification += `\nUsername: @${user.username}`;
        for (const adminId of ADMIN_IDS) {
            try { await ctx.telegram.sendMessage(adminId, adminNotification, { parse_mode: 'Markdown' }); } catch (e) { console.error(`Failed to notify admin ${adminId}:`, e); }
        }

        // Create new user
        const newUser = {
            _id: userId,
            first_name: user.first_name,
            username: user.username,
            credits: INITIAL_CREDITS,
            searches: 0,
            join_date: new Date()
        };
        await usersCollection.insertOne(newUser);
        await ctx.reply(`🎉 Welcome aboard, ${user.first_name}!\n\nAs a new member, you've received *${INITIAL_CREDITS} free credits*.`, { parse_mode: 'Markdown' });
        userDoc = newUser;
    }

    const welcomeMessage = `🎯 *Welcome, ${user.first_name}!*` +
                           `\n\n💳 *Your Credits:* ${userDoc.credits}` +
                           `\n📊 *Total Searches:* ${userDoc.searches}` +
                           `\n🗓️ *Member Since:* ${new Date(userDoc.join_date).toLocaleDateString()}`;

    await ctx.reply(welcomeMessage, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(userId)
    });
});

// --- BUTTON HANDLERS ---
bot.hears("My Account 📊", async (ctx) => {
    const userDoc = await usersCollection.findOne({ _id: ctx.from.id });
    if (!userDoc) return ctx.reply("Please press /start to register.");

    const accountMessage = `🎯 *Welcome, ${ctx.from.first_name}!*` +
                           `\n\n💳 *Your Credits:* ${userDoc.credits}` +
                           `\n📊 *Total Searches:* ${userDoc.searches}` +
                           `\n🗓️ *Member Since:* ${new Date(userDoc.join_date).toLocaleDateString()}`;
    await ctx.reply(accountMessage, { parse_mode: 'Markdown', ...getMainMenuKeyboard(ctx.from.id) });
});

bot.hears("Help ❓", (ctx) => ctx.reply(
    `❓ *Help & Support Center*\n\n` +
    `🔍 *How to Use:*\n• Send a phone number to get its report.\n• Each search costs 1 credit.\n\n` +
    `🎁 *Referral Program:*\n• Get ${REFERRAL_CREDIT} credit per successful referral.\n\n` +
    `👤 *Support:* ${SUPPORT_ADMIN}`, { parse_mode: 'Markdown' }
));

bot.hears("Refer & Earn 🎁", (ctx) => {
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    ctx.reply(
        `*Invite friends and earn credits!* 🎁\n\n` +
        `You get ${REFERRAL_CREDIT} credit for every new user who starts the bot through your link.\n\n` +
        `Your link: \`${referralLink}\``, { parse_mode: 'Markdown' }
    );
});

bot.hears("Buy Credits 💰", (ctx) => ctx.reply(
    `💰 *Buy Credits - Price List*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💎 *STARTER* - 25 Credits (₹49)\n` +
    `🔥 *BASIC* - 100 Credits (₹149)\n` +
    `⭐ *PRO* - 500 Credits (₹499)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💬 Contact admin to buy: ${SUPPORT_ADMIN}`, { parse_mode: 'Markdown' }
));

// --- ADMIN HANDLERS ---
bot.hears("Member Status 👥", async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) return;
    const totalMembers = await usersCollection.countDocuments({});
    await ctx.reply(`📊 *Bot Member Status*\n\nTotal Members: *${totalMembers}*`, { parse_mode: 'Markdown' });
});

bot.command("addcredit", async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length !== 3) return ctx.reply("Usage: /addcredit <user_id> <amount>");
    
    const targetId = parseInt(parts[1], 10);
    const amount = parseInt(parts[2], 10);
    
    if (isNaN(targetId) || isNaN(amount)) return ctx.reply("Invalid User ID or amount.");

    const result = await usersCollection.updateOne({ _id: targetId }, { $inc: { credits: amount } });
    if (result.matchedCount === 0) return ctx.reply("User not found.");

    await ctx.reply(`✅ Success! Added ${amount} credits to user ${targetId}.`);
    try {
        await ctx.telegram.sendMessage(targetId, `🎉 An administrator has added *${amount} credits* to your account!`, { parse_mode: 'Markdown' });
    } catch (e) { console.error(`Failed to notify user ${targetId} about credits:`, e); }
});


// --- CORE NUMBER LOOKUP HANDLER ---
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const number = ctx.message.text.trim();

    if (!/^\d{10,}$/.test(number)) {
        return ctx.reply("Please send a valid number or use the menu buttons.");
    }
    
    const userDoc = await usersCollection.findOne({ _id: userId });
    if (!userDoc) return ctx.reply("Please press /start to register.");
    if (userDoc.credits < 1) return ctx.reply("You have insufficient credits.");

    const processingMessage = await ctx.reply('🔎 Accessing database... This will consume 1 credit.');
    
    try {
        await usersCollection.updateOne({ _id: userId }, { $inc: { credits: -1, searches: 1 } });

        const response = await axios.get(`https://numinfoapi.vercel.app/api/num?number=${number}`, { timeout: 15000 });
        
        await ctx.deleteMessage(processingMessage.message_id);

        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            await ctx.reply(`✅ *Database Report Generated!*\nFound *${response.data.length}* record(s) for \`${number}\`. Details below:`, { parse_mode: 'Markdown' });
            for (const [index, record] of response.data.entries()) {
                await ctx.reply(formatRealRecordAsMessage(record, index, response.data.length), { parse_mode: 'Markdown' });
            }
        } else {
            throw new Error("No data found");
        }
    } catch (error) {
        await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined,
            `❌ *No Data Found.*\nPlease check the number and try again. Ensure you are entering a correct 10-digit number.`
        , { parse_mode: 'Markdown' });
        await usersCollection.updateOne({ _id: userId }, { $inc: { credits: 1, searches: -1 } });
    } finally {
        const finalUserDoc = await usersCollection.findOne({ _id: userId });
        await ctx.reply(`💳 Credits remaining: *${finalUserDoc.credits}*`, { parse_mode: 'Markdown' });
    }
});


// --- EXPORT FOR VERCEL ---
module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error("Error handling update:", err);
    }
};
