import asyncio
import hashlib
import aiohttp
import urllib.parse  
import json   
import re
import os
import logging
from dotenv import load_dotenv
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandObject
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.redis import RedisStorage
from redis.asyncio import Redis
import aiomysql
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from typing import Optional, Tuple, List, Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
LINK4M_API = os.getenv("LINK4M_API")
SECRET_KEY = os.getenv("SECRET_KEY")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))

RATE = 100              
MAX_LEVEL = 20          
BASE_SPEED = 7000       
SPEED_MULTIPLIER = 1.16 
BASE_EXP_NEEDED = 100   
EXP_MULTIPLIER = 1.35   
BASE_EXP_PER_LINK = 15  
LINK_EXP_MULTIPLIER = 1.10 

MIN_WITHDRAW_VND = 2000
MAX_WITHDRAW_VND = 10000
MIN_WITHDRAW_XU = MIN_WITHDRAW_VND * RATE

bot = Bot(token=BOT_TOKEN)

# 1. Quản lý State bằng Redis
redis_client = Redis(host=os.getenv("REDIS_HOST", "localhost"), port=int(os.getenv("REDIS_PORT", 6379)), db=0)
storage = RedisStorage(redis_client)
dp = Dispatcher(storage=storage)

class WithdrawForm(StatesGroup):
    waiting_for_amount = State()
    waiting_for_info = State()

# 2. Cứng hóa múi giờ bằng zoneinfo
def get_now_vn():
    return datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).replace(tzinfo=None)

# ================= DATABASE HELPER (MYSQL POOL) =================
# ================= DATABASE HELPER (MYSQL POOL) =================
async def fetch_one(pool: aiomysql.Pool, query: str, args: Tuple = ()) -> Optional[Tuple[Any, ...]]:
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, args)
            return await cur.fetchone()

async def fetch_all(pool: aiomysql.Pool, query: str, args: Tuple = ()) -> List[Tuple[Any, ...]]:
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, args)
            return await cur.fetchall()

async def execute_db(pool: aiomysql.Pool, query: str, args: Tuple = ()) -> None:
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute(query, args)
                await conn.commit()
            except Exception as e:
                await conn.rollback()
                logging.error(f"Lỗi DB, đã rollback: {e}")
                raise e
async def init_db(pool):
    queries = [
        '''CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            username VARCHAR(255),
            level INT DEFAULT 1,
            exp INT DEFAULT 0,
            xu_balance BIGINT DEFAULT 0,
            mining_end_time DATETIME,
            last_free_claim DATETIME,
            last_mining_update DATETIME,
            last_withdrawal DATETIME
        )''',
        '''CREATE TABLE IF NOT EXISTS global_tasks (
            cycle_date VARCHAR(20),
            task_id INT,
            short_link TEXT,
            PRIMARY KEY (cycle_date, task_id)
        )''',
        '''CREATE TABLE IF NOT EXISTS user_completed_tasks (
            user_id BIGINT,
            cycle_date VARCHAR(20),
            task_id INT,
            PRIMARY KEY (user_id, cycle_date, task_id)
        )'''
    ]
    for q in queries:
        await execute_db(pool, q)

# ================= HÀM HỖ TRỢ LÕI =================
def get_current_cycle():
    now = get_now_vn()
    if now.hour < 6:
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")
    return now.strftime("%Y-%m-%d")

def generate_global_token(task_id, cycle_date):
    text = f"GLOBAL_{task_id}_{cycle_date}_{SECRET_KEY}"
    return hashlib.sha256(text.encode()).hexdigest()[:10]

# ================= HÀM HỖ TRỢ LÕI =================
async def get_user(pool: aiomysql.Pool, user_id: int, display_name: str) -> Tuple:
    user = await fetch_one(pool, "SELECT * FROM users WHERE user_id = %s", (user_id,))
    if not user:
        await execute_db(pool, "INSERT INTO users (user_id, username) VALUES (%s, %s)", (user_id, display_name))
        return (user_id, display_name, 1, 0, 0, None, None, None, None)
    
    await execute_db(pool, "UPDATE users SET username = %s WHERE user_id = %s", (display_name, user_id))
    user_list = list(user)
    user_list[1] = display_name
    return tuple(user_list)

async def update_mining_xu(pool: aiomysql.Pool, user_id: int) -> None:
    MAX_SPEED_CAP = 500000 
    user = await fetch_one(pool, "SELECT level, xu_balance, mining_end_time, last_mining_update FROM users WHERE user_id = %s", (user_id,))
    if not user: return

    level, xu, end_time, last_update = user
    if not end_time or not last_update: return

    now = get_now_vn()
    if last_update >= end_time: return

    calc_time = min(now, end_time)
    diff = calc_time - last_update
    seconds_passed = diff.total_seconds()

    if seconds_passed > 0:
        raw_speed = BASE_SPEED * (SPEED_MULTIPLIER ** (level - 1))
        speed_per_hour = min(raw_speed, MAX_SPEED_CAP)
        earned_xu = int(seconds_passed * (speed_per_hour / 3600))
        
        if earned_xu > 0:
            await execute_db(
                pool,
                "UPDATE users SET xu_balance = xu_balance + %s, last_mining_update = %s WHERE user_id = %s", 
                (earned_xu, calc_time, user_id)
            )

def get_exp_required(level):
    return int(BASE_EXP_NEEDED * (EXP_MULTIPLIER ** (level - 1)))

def get_exp_per_link(level):
    return int(BASE_EXP_PER_LINK * (LINK_EXP_MULTIPLIER ** (level - 1)))

def check_6am_reset(last_claim):
    if not last_claim: return True
    if isinstance(last_claim, str):
        last_claim = datetime.strptime(last_claim, "%Y-%m-%d %H:%M:%S")
    now = get_now_vn()
    reset_time = now.replace(hour=6, minute=0, second=0, microsecond=0)
    if now < reset_time:
        reset_time -= timedelta(days=1)
    return last_claim < reset_time

def format_time_remaining(end_time):
    if not end_time: return "00:00:00 (Đang dừng)"
    if isinstance(end_time, str):
        end_time = datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S")
    now = get_now_vn()
    if now >= end_time: return "00:00:00 (Đang dừng)"
    diff = end_time - now
    hours, remainder = divmod(diff.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    total_hours = hours + (diff.days * 24)
    return f"{total_hours:02d}:{minutes:02d}:{seconds:02d}"

def is_currently_mining(end_time):
    if not end_time: return False
    if isinstance(end_time, str):
        end_time = datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S")
    return get_now_vn() < end_time

# ================= GIAO DIỆN BÀN PHÍM =================
WEB_APP_URL = "https://link-web-app-cua-ong.vercel.app/" 

main_menu = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="👤 Thông Tin"), KeyboardButton(text="🎮 Nhận Nhiệm Vụ")],
        [KeyboardButton(text="💸 Rút Tiền"), KeyboardButton(text="🏆 Bảng Xếp Hạng")],
        # Thêm nút mở Mini App
        [KeyboardButton(text="📺 Xem Quảng Cáo (Mini App)", web_app=WebAppInfo(url=WEB_APP_URL))]
    ],
    resize_keyboard=True
)

async def create_short_link(target_url: str, session: aiohttp.ClientSession, bot_instance: Bot) -> Optional[str]:
    encoded_url = urllib.parse.quote(target_url, safe='')
    api_url = f"https://link4m.co/st?api={LINK4M_API}&url={encoded_url}"
    try:
        async with session.get(api_url, timeout=10) as resp:
            raw_text = await resp.text()
            try:
                data = json.loads(raw_text)
                if data.get("status") == "success" or "shortenedUrl" in data:
                    return data.get("shortenedUrl")
            except json.JSONDecodeError: pass
            
            if raw_text.startswith("http") and "<html" not in raw_text:
                return raw_text.strip()
                
            match = re.search(r'content="(https?://link4m\.(org|com|co|net|app)/(go/)?[a-zA-Z0-9]+)"', raw_text)
            if match: return match.group(1)
            
    except asyncio.TimeoutError:
        logging.error("[LỖI] API Link4M phản hồi quá lâu (Timeout)")
    except aiohttp.ClientError as e:
        logging.error(f"[LỖI HTTP CLIENT] Call API Link4M lỗi: {e}")
    except Exception as e: 
        logging.error(f"[LỖI HỆ THỐNG - LINK4M] {e}")
        if ADMIN_ID != 0:
            try:
                # Dùng bot_instance đc truyền vào thay vì gọi biến toàn cục
                await bot_instance.send_message(chat_id=ADMIN_ID, text=f"⚠️ **LỖI HỆ THỐNG - LINK4M API:**\n`{e}`", parse_mode="Markdown")
            except Exception as e_admin:
                logging.warning(f"Lỗi gửi tin báo cho admin: {e_admin}")
    return None


@dp.message(F.web_app_data)
async def handle_webapp_data(message: types.Message, pool: aiomysql.Pool):
    # Lấy chuỗi dữ liệu do Frontend bắn về
    raw_data = message.web_app_data.data
    user_id = message.from_user.id
    
    try:
        # Chuyển chuỗi JSON thành Dictionary của Python
        data = json.loads(raw_data)
        action = data.get("action")
        reward_xu = data.get("xu", 0)
        
        if action == "ads_completed" and reward_xu > 0:
            # Cộng tiền vào Database
            await execute_db(
                pool, 
                "UPDATE users SET xu_balance = xu_balance + %s WHERE user_id = %s", 
                (reward_xu, user_id)
            )
            
            await message.answer(
                f"🎉 Bting! Ông vừa xem xong quảng cáo và nhận đc **{reward_xu} Xu**.\n"
                f"Tiếp tục cày cuốc nhé!", 
                parse_mode="Markdown"
            )
        else:
            await message.answer("⚠️ Dữ liệu từ Web App gửi về ko hợp lệ.")
            
    except json.JSONDecodeError:
        logging.error(f"[LỖI WEBAPP] Dữ liệu ko phải JSON chuẩn: {raw_data}")
        await message.answer("❌ Có lỗi xảy ra khi xử lý phần thưởng từ Web App.")
    except Exception as e:
        logging.error(f"[LỖI WEBAPP - HỆ THỐNG] {e}")
        
# ================= XỬ LÝ LỆNH CHÍNH =================

@dp.message(Command("start"))
async def cmd_start(message: types.Message, command: CommandObject, pool: aiomysql.Pool): 
    user_id = message.from_user.id
    username = message.from_user.username if message.from_user.username else message.from_user.full_name
    args = command.args 

    user = await get_user(pool, user_id, username)
    
    if args and args.startswith("nhiemvu_"):
        parts = args.split("_")
        if len(parts) == 4:
            _, task_id_str, cycle_date, token = parts
            task_id = int(task_id_str)
            
            if token == generate_global_token(task_id_str, cycle_date):
                if await fetch_one(pool, "SELECT 1 FROM user_completed_tasks WHERE user_id = %s AND cycle_date = %s AND task_id = %s", (user_id, cycle_date, task_id)):
                    await message.answer("⚠️ Ông khôn đấy, nhưng link này ông đã nhận thưởng rồi. Qua làm link khác đi!")
                    return
                
                level, current_exp = user[2], user[3]
                exp_nhan_dc = get_exp_per_link(level)
                new_exp = current_exp + exp_nhan_dc
                
                leveled_up = False
                while level < MAX_LEVEL and new_exp >= get_exp_required(level):
                    new_exp -= get_exp_required(level)
                    level += 1
                    leveled_up = True
                
                if level >= MAX_LEVEL:
                    level = MAX_LEVEL
                    new_exp = 0 
                
                await execute_db(pool, "INSERT INTO user_completed_tasks (user_id, cycle_date, task_id) VALUES (%s, %s, %s)", (user_id, cycle_date, task_id))
                await execute_db(pool, "UPDATE users SET exp = %s, level = %s WHERE user_id = %s", (new_exp, level, user_id))
                
                if leveled_up:
                    await message.answer(f"🎉 **LÊN CẤP!** Chúc mừng ông đã đạt **Cấp {level}**!\nÔng nhận đc **{exp_nhan_dc} EXP**.", parse_mode="Markdown")
                else:
                    await message.answer(f"🎉 Xuất sắc! Ông đã hoàn thành nhiệm vụ và nhận đc **{exp_nhan_dc} EXP**.", parse_mode="Markdown")
                return
            else:
                await message.answer("❌ Link nhiệm vụ ko hợp lệ hoặc mã bảo mật đã bị sai lệch!")
                return
                    
    await message.answer("Chào mừng ông đã đến với Bot Đào Xu! Chọn tính năng ở menu bên dưới nhé 👇", reply_markup=main_menu)

@dp.message(F.text == "👤 Thông Tin")
async def show_profile(message: types.Message, pool: aiomysql.Pool, is_edit=False, callback_query=None):
    user_data = message if not is_edit else callback_query
    user_id = user_data.from_user.id
    username_raw = user_data.from_user.username if user_data.from_user.username else user_data.from_user.full_name
    
    await update_mining_xu(pool, user_id)
    user = await get_user(pool, user_id, username_raw)
    
    _, username, level, exp, xu, mining_end_time, last_free, _, last_withdrawal = user
    vnd = xu / RATE
    speed = int(BASE_SPEED * (SPEED_MULTIPLIER ** (level - 1)))
    time_str = format_time_remaining(mining_end_time)
    
    exp_display = "MAX LEVEL" if level >= MAX_LEVEL else f"{exp}/{get_exp_required(level)}"
    
    text = (f"👤 **THÔNG TIN TÀI KHOẢN**\n"
            f"➖ Tên: @{username}\n"
            f"➖ Cấp độ: Lv {level}\n"
            f"➖ EXP: {exp_display}\n\n"
            f"⛏ **MÁY ĐÀO XU**\n"
            f"➖ Tốc độ: {speed:,} Xu/giờ\n"
            f"➖ Thời gian còn lại: `{time_str}`\n\n"
            f"💰 **VÍ TIỀN**\n"
            f"➖ Số dư: {xu:,} Xu (~{vnd:,.0f} VNĐ)\n"
            f"➖ Tỉ lệ quy đổi: {RATE} Xu = 1 VNĐ\n")
    
    kb = [[InlineKeyboardButton(text="🔄 Làm mới thời gian", callback_data="refresh_profile")]]
    if check_6am_reset(last_free):
        kb.append([InlineKeyboardButton(text="🎁 Kích hoạt Đào Free", callback_data="claim_free")])
    kb.append([InlineKeyboardButton(text="📜 Lịch sử rút tiền", callback_data="history")])
    
    markup = InlineKeyboardMarkup(inline_keyboard=kb)
    
    if is_edit:
        try:
            await callback_query.message.edit_text(text, reply_markup=markup, parse_mode="Markdown")
            await callback_query.answer("Đã làm mới thông tin!")
        except Exception:
            await callback_query.answer("Thời gian chưa thay đổi!", show_alert=False)
    else:
        await message.answer(text, reply_markup=markup, parse_mode="Markdown")

@dp.callback_query(F.data == "refresh_profile")
async def process_refresh(callback: types.CallbackQuery, pool: aiomysql.Pool):
    await show_profile(message=None, pool=pool, is_edit=True, callback_query=callback)

@dp.message(F.text == "🎮 Nhận Nhiệm Vụ")
async def get_quest(message: types.Message, pool: aiomysql.Pool):
    user_id = message.from_user.id
    cycle_date = get_current_cycle()
    
    global_tasks = await fetch_all(pool, "SELECT task_id, short_link FROM global_tasks WHERE cycle_date = %s ORDER BY task_id", (cycle_date,))
        
    if len(global_tasks) < 10:
        await message.answer("⏳ Hệ thống đang tự động làm mới nhiệm vụ. Ông quay lại sau 1-2 phút nữa nhé!")
        return

    completed_tasks = await fetch_all(pool, "SELECT task_id FROM user_completed_tasks WHERE user_id = %s AND cycle_date = %s", (user_id, cycle_date))
    completed_ids = [row[0] for row in completed_tasks]

    emojis = ["⚡", "🧃", "🍌", "🍎", "🔥", "🍉", "🍇", "🍓", "🍍", "🥭"]
    text = f"📋 **DANH SÁCH 10 NHIỆM VỤ HÔM NAY**\n*(Reset làm mới lúc 6:00 sáng)*\n\n"
    
    kb = []
    completed_count = 0
    
    for i, task in enumerate(global_tasks):
        t_id, link = task
        emoji = emojis[i % len(emojis)]
        
        if t_id in completed_ids:
            text += f"~~{emoji} Link {t_id}: {link}~~ ✅\n"
            completed_count += 1
        else:
            text += f"{emoji} Link {t_id}: `{link}`\n"
            kb.append(InlineKeyboardButton(text=f"🔗 Vượt Link {t_id}", url=link))
            
    text += f"\n📊 Tiến độ của ông: **{completed_count}/10**"
    
    markup_kb = [kb[i:i+2] for i in range(0, len(kb), 2)]
    markup = InlineKeyboardMarkup(inline_keyboard=markup_kb) if kb else None
    
    if completed_count == 10:
        await message.answer(text + "\n\n🎉 Tuyệt vời! Ông đã dọn sạch toàn bộ nhiệm vụ hôm nay.", parse_mode="Markdown")
    else:
        await message.answer(text, reply_markup=markup, parse_mode="Markdown")

@dp.callback_query(F.data == "claim_free")
async def process_free_claim(callback: types.CallbackQuery, pool: aiomysql.Pool):
    user_id = callback.from_user.id
    username_raw = callback.from_user.username if callback.from_user.username else callback.from_user.full_name
    user = await get_user(pool, user_id, username_raw)
    mining_end_time, last_free = user[5], user[6]
    
    if not check_6am_reset(last_free):
        await callback.answer("Ông đã nhận Free hôm nay rồi! Đợi 6h sáng mai nhé.", show_alert=True)
        return
        
    if is_currently_mining(mining_end_time):
        await callback.answer("❌ Máy đang đào rồi, đợi hết hạn mới đc nhận tiếp nhé!", show_alert=True)
        return
            
    now = get_now_vn()
    new_end_time = now + timedelta(hours=4)
    
    await execute_db(pool, "UPDATE users SET mining_end_time = %s, last_free_claim = %s, last_mining_update = %s WHERE user_id = %s", (new_end_time, now, now, user_id))
    
    await callback.answer("🎉 Chúc mừng! Máy đào đã đc kích hoạt chạy 4 tiếng.", show_alert=True)
    await show_profile(message=None, pool=pool, is_edit=True, callback_query=callback)

@dp.message(F.text == "💸 Rút Tiền")
async def withdraw_money(message: types.Message, pool: aiomysql.Pool):
    user_id = message.from_user.id
    username_raw = message.from_user.username if message.from_user.username else message.from_user.full_name
    
    await get_user(pool, user_id, username_raw)
    row = await fetch_one(pool, "SELECT level, xu_balance, last_withdrawal FROM users WHERE user_id = %s", (user_id,))
    level, xu, last_withdrawal = row
    
    if level < 5:
        await message.answer("⚠️ Yêu cầu đạt **Cấp 5** trở lên mới đc rút tiền.", parse_mode="Markdown")
        return
        
    if not check_6am_reset(last_withdrawal):
        await message.answer("⚠️ Giới hạn rút 1 lần/ngày. Đợi sau 6h sáng mai nhé!", parse_mode="Markdown")
        return
        
    # Thay 200000 bằng hằng số
    if xu < MIN_WITHDRAW_XU:
        await message.answer(f"⚠️ **Số dư ko đủ:** Min rút là {MIN_WITHDRAW_VND:,} VNĐ ({MIN_WITHDRAW_XU:,} Xu).\nSố dư: {xu:,} Xu.", parse_mode="Markdown")
        return
        
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💳 Rút toàn bộ về Ngân Hàng", callback_data="wd_bank")],
        [InlineKeyboardButton(text="📱 Rút toàn bộ về Momo", callback_data="wd_momo")]
    ])
    
    await message.answer(
        f"🎉 **Tài khoản đủ điều kiện rút tiền!**\n\n"
        f"➖ Số dư hiện tại: **{xu:,} Xu** (~{xu/RATE:,.0f} VNĐ)\n"
        f"➖ Giới hạn: **1 lần / ngày** (Reset lúc 06:00)\n\n"
        f"Chọn cổng thanh toán để rút toàn bộ số dư:", 
        reply_markup=kb, 
        parse_mode="Markdown"
    )

@dp.callback_query(F.data.in_({'wd_bank', 'wd_momo'}))
async def process_withdrawal_callback(callback: types.CallbackQuery, state: FSMContext, pool: aiomysql.Pool):
    user_id = callback.from_user.id
    
    row = await fetch_one(pool, "SELECT xu_balance, last_withdrawal FROM users WHERE user_id = %s", (user_id,))
    if not row:
        await callback.answer("Lỗi dữ liệu user!", show_alert=True)
        return
        
    xu, last_withdrawal = row
    
    if xu < 200000:
        await callback.answer("Số dư của ông ko đủ 200.000 Xu để khởi tạo lệnh rút!", show_alert=True)
        return
        
    if not check_6am_reset(last_withdrawal):
        await callback.answer("Hôm nay ông đã rút rồi, ráng đợi 6h sáng mai nhé!", show_alert=True)
        return

    method = "Ngân Hàng" if callback.data == "wd_bank" else "Momo"
    await state.update_data(method=method, current_xu=xu) 
    await state.set_state(WithdrawForm.waiting_for_amount)
    
    await callback.message.edit_text(
        f"💰 **RÚT TIỀN VỀ {method.upper()}**\n\n"
        f"➖ Số dư hiện tại: **{xu:,} Xu** (~{xu/RATE:,.0f} VNĐ)\n"
        f"➖ Hạn mức: Từ **2.000 VNĐ** đến **10.000 VNĐ**\n\n"
        f"✍️ _Hãy gõ số tiền (VNĐ) ông muốn rút và gửi lên đây (VD: 5000)..._", 
        parse_mode="Markdown"
    )

@dp.message(WithdrawForm.waiting_for_amount)
async def get_withdraw_amount(message: types.Message, state: FSMContext):
    data = await state.get_data()
    current_xu = data.get("current_xu", 0)
    method = data.get("method")
    
    try:
        amount_vnd = int(message.text.strip())
    except ValueError:
        await message.answer("❌ Lỗi: Ông phải nhập một con số hợp lệ (VD: 5000). Vui lòng nhập lại!")
        return
        
    if amount_vnd < MIN_WITHDRAW_VND or amount_vnd > MAX_WITHDRAW_VND:
        await message.answer(f"⚠️ Số tiền rút phải nằm trong khoảng **{MIN_WITHDRAW_VND:,} VNĐ** đến **{MAX_WITHDRAW_VND:,} VNĐ**. Vui lòng nhập lại!")
        return
        
    xu_needed = amount_vnd * RATE
    if current_xu < xu_needed:
        await message.answer(f"⚠️ Số dư không đủ! Ông cần {xu_needed:,} Xu để rút {amount_vnd:,} VNĐ, nhưng chỉ có {current_xu:,} Xu. Nhập lại số nhỏ hơn nhé!")
        return
        
    await state.update_data(amount_vnd=amount_vnd, xu_needed=xu_needed)
    await state.set_state(WithdrawForm.waiting_for_info)
    
    if method == "Ngân Hàng":
        await message.answer("🏦 **BƯỚC TIẾP THEO**\nVui lòng nhập thông tin nhận tiền của ông theo mẫu sau:\n`Tên Ngân hàng - Số tài khoản - Họ Tên`\n*(VD: MBBank - 0123456789 - TRAN TIEN DUNG)*\n\n✍️ _Hãy gõ và gửi tin nhắn ngay dưới đây..._", parse_mode="Markdown")
    else:
        await message.answer("📱 **BƯỚC TIẾP THEO**\nVui lòng nhập thông tin Momo của ông theo mẫu sau:\n`Số điện thoại - Họ Tên`\n*(VD: 0987654321 - TRAN TIEN DUNG)*\n\n✍️ _Hãy gõ và gửi tin nhắn ngay dưới đây..._", parse_mode="Markdown")

@dp.message(WithdrawForm.waiting_for_info)
async def get_withdraw_info(message: types.Message, state: FSMContext, pool: aiomysql.Pool):
    user_info = message.text
    user_id = message.from_user.id
    username = message.from_user.full_name 
    
    data = await state.get_data()
    amount_vnd = data.get("amount_vnd")
    xu_needed = data.get("xu_needed")
    method = data.get("method")
    
    row = await fetch_one(pool, "SELECT xu_balance FROM users WHERE user_id = %s", (user_id,))
    xu = row[0] if row else 0
    if xu < xu_needed:
        await message.answer("❌ Lệnh bị hủy do số dư không đủ!")
        await state.clear()
        return

    now = get_now_vn()
    await execute_db(pool, "UPDATE users SET xu_balance = xu_balance - %s, last_withdrawal = %s WHERE user_id = %s", (xu_needed, now, user_id))
    
    await message.answer(f"✅ **ĐẶT LỆNH RÚT THÀNH CÔNG!**\n\n➖ Phương thức: **{method}**\n➖ Số tiền rút: **{amount_vnd:,.0f} VNĐ**\n➖ Thông tin nhận: `{user_info}`\n\nHệ thống đã ghi nhận, admin sẽ xử lý sớm nhất!", parse_mode="Markdown")
    
    admin_msg = f"🚨 **CÓ ĐƠN RÚT TIỀN MỚI!** 🚨\n\n👤 Từ user: {username} (ID: {user_id})\n💰 Số tiền: **{amount_vnd:,.0f} VNĐ**\n💳 Phương thức: **{method}**\n📝 Thông tin nhận: `{user_info}`"
    
    admin_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Thành công", callback_data=f"wd_ok_{user_id}_{xu_needed}"),
         InlineKeyboardButton(text="❌ Không thành công", callback_data=f"wd_no_{user_id}_{xu_needed}")]
    ])
    
    try:
        await bot.send_message(chat_id=ADMIN_ID, text=admin_msg, reply_markup=admin_kb, parse_mode="Markdown")
    except Exception as e:
        logging.warning(f"[LỖI] Ko thể gửi tin nhắn cho Admin: {e}")
            
    await state.clear()

@dp.message(F.text == "🏆 Bảng Xếp Hạng")
async def show_leaderboard(message: types.Message, pool: aiomysql.Pool):
    all_users = await fetch_all(pool, "SELECT user_id FROM users")
    
    for u in all_users:
        await update_mining_xu(pool, u[0])

    top_users = await fetch_all(pool, "SELECT username, level, exp, xu_balance FROM users ORDER BY level DESC, exp DESC, xu_balance DESC LIMIT 10")
    
    if not top_users:
        await message.answer("Bảng xếp hạng hiện đang trống!")
        return
        
    text = "🏆 **BẢNG XẾP HẠNG THỢ MỎ** 🏆\n\n"
    medals = ["🥇", "🥈", "🥉"]
    
    for index, user in enumerate(top_users):
        username = user[0] if user[0] else "Ẩn danh"
        level = user[1]
        xu = user[3]
        rank_icon = medals[index] if index < 3 else f"**{index + 1}.**"
        text += f"{rank_icon} @{username} | **Lv {level}** | 💰 {xu:,} Xu\n"
        
    text += "\n*(Cập nhật liên tục dựa trên Level và số Xu đang có)*"
    await message.answer(text, parse_mode="Markdown")

@dp.callback_query(F.data.startswith("wd_no_"))
async def admin_reject_wd(callback: types.CallbackQuery, pool: aiomysql.Pool):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Bạn không phải là Admin!", show_alert=True)
        return
        
    parts = callback.data.split("_")
    target_user_id = int(parts[2])
    xu_refund = int(parts[3])

    await execute_db(pool, "UPDATE users SET xu_balance = xu_balance + %s WHERE user_id = %s", (xu_refund, target_user_id))

    original_text = callback.message.text
    await callback.message.edit_text(f"{original_text}\n\n❌ **TRẠNG THÁI: ĐĐÃ HỦY VÀ HOÀN XU!**", parse_mode="Markdown")

    try:
        await bot.send_message(chat_id=target_user_id, text=f"❌ **GIAO DỊCH BỊ TỪ CHỐI!**\n\nLệnh rút tiền của ông bị hủy. Bot đã hoàn trả lại **{xu_refund:,} Xu** vào ví của ông.", parse_mode="Markdown")
    except Exception as e:
        logging.warning(f"[CẢNH BÁO] Không gửi đc tin báo từ chối cho user {target_user_id}: {e}")

# ================= TỰ ĐỘNG HÓA =================
async def generate_links_job(pool: aiomysql.Pool, bot_instance: Bot):
    cycle_date = get_current_cycle()
    logging.info(f"[AUTO] Bắt đầu tự động tạo link nhiệm vụ cho ngày {cycle_date}...")
    
    bot_info = await bot_instance.get_me()
    bot_username = bot_info.username
    
    row = await fetch_one(pool, "SELECT COUNT(*) FROM global_tasks WHERE cycle_date = %s", (cycle_date,))
    count = row[0] if row else 0
    
    if count < 10:
        async with aiohttp.ClientSession() as session:
            for i in range(1, 11):
                if not await fetch_one(pool, "SELECT 1 FROM global_tasks WHERE cycle_date = %s AND task_id = %s", (cycle_date, i)):
                    token = generate_global_token(str(i), cycle_date) 
                    target_url = f"https://t.me/{bot_username}?start=nhiemvu_{i}_{cycle_date}_{token}"
                    
                    # Truyền bot_instance vào đây
                    short_link = await create_short_link(target_url, session, bot_instance)
                    
                    if short_link:
                        await execute_db(pool, "INSERT INTO global_tasks (cycle_date, task_id, short_link) VALUES (%s, %s, %s)", (cycle_date, i, short_link))
                        logging.info(f"[AUTO] Tạo thành công Link {i}")
                    await asyncio.sleep(2) 
        logging.info(f"[AUTO] Hoàn thành tạo bộ nhiệm vụ ngày {cycle_date}!")
    else:
        logging.info(f"[AUTO] Ngày {cycle_date} đã có đủ 10 link, bỏ qua.")

@dp.callback_query(F.data.startswith("wd_ok_"))
async def admin_approve_wd(callback: types.CallbackQuery, pool: aiomysql.Pool): 
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Bạn không phải là Admin!", show_alert=True)
        return
        
    parts = callback.data.split("_")
    target_user_id = int(parts[2])
    xu_deducted = int(parts[3])
    vnd_rut = int(xu_deducted / RATE)

    original_text = callback.message.text
    await callback.message.edit_text(f"{original_text}\n\n✅ **TRẠNG THÁI: ĐÃ DUYỆT VÀ CHUYỂN TIỀN!**", parse_mode="Markdown")

    try:
        await bot.send_message(
            chat_id=target_user_id, 
            text=f"🎉 **GIAO DỊCH THÀNH CÔNG!**\n\nAdmin đã chuyển khoản thành công **{vnd_rut:,.0f} VNĐ** vào tài khoản của ông.", 
            parse_mode="Markdown"
        )
    except Exception as e:
        logging.warning(f"[CẢNH BÁO] Không gửi đc tin báo thành công cho user {target_user_id}: {e}")

async def main():
    logging.info("🚀 Khởi chạy V6.0 (Tối ưu MySQL Pool, Redis FSM, Timezone)...")
    
    # Khởi tạo MySQL Pool
    pool = await aiomysql.create_pool(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', 3306)),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASS', ''),
        db=os.getenv('DB_NAME', 'bot_db'),
        autocommit=False
    )
    
    await init_db(pool)
    dp.workflow_data.update(pool=pool)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(generate_links_job, 'cron', hour=6, minute=0, second=0, args=[pool, bot])
    scheduler.start()
    
    asyncio.create_task(generate_links_job(pool, bot))

    try:
        await dp.start_polling(bot)
    finally:
        pool.close()
        await pool.wait_closed()
        await redis_client.close()

if __name__ == "__main__":
    asyncio.run(main())