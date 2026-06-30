import sqlite3

# Kết nối tới database của bot
conn = sqlite3.connect('bot_data.db')
cursor = conn.cursor()

# Username trong Telegram DB thường lưu không có dấu @
username_to_update = "Ttdung2k606" , "ttdung3864"

# Tiến hành cập nhật Level 20 (Max) và 10.000.000 Xu
cursor.execute("""
    UPDATE users 
    SET level = 20, exp = 0, xu_balance = 10000000 
    WHERE username = ?
""", (username_to_update,))

if cursor.rowcount > 0:
    conn.commit()
    print(f"✅ Đã cập nhật thành công cho @{username_to_update} lên Cấp 20 và 10,000,000 Xu để test!")
else:
    print(f"❌ Không tìm thấy người dùng có username là '{username_to_update}' trong DB.")
    print("👉 Lưu ý: Tài khoản này phải bấm /start vào bot ít nhất 1 lần để hệ thống khởi tạo dữ liệu trước đã nhé ông!")

conn.close()