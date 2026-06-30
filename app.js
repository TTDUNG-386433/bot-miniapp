// Khởi tạo SDK Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand(); // Buộc app bung rộng hết màn hình

// 1. Tự động map thông tin thật từ tài khoản Telegram của user vào UI
if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const user = tg.initDataUnsafe.user;
    // Điền username (nếu ko có lấy full name)
    document.getElementById("user-name").innerText = user.username ? `@${user.username}` : user.first_name;
} else {
    // Dự phòng khi test bằng trình duyệt máy tính ko thông qua Telegram
    document.getElementById("user-name").innerText = "@ttdung3864";
}

// 2. Logic chuyển đổi Tab (Trang Chủ <-> Nhiệm Vụ)
function switchTab(tabId) {
    // Ẩn toàn bộ các tab
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Hiển thị tab được chọn
    document.getElementById(tabId).classList.add('active');
    
    // Cập nhật trạng thái active cho thanh Menu đáy
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    // Tìm đúng nút điều hướng tương ứng dựa vào sự kiện click để active màu xanh
    if (tabId === 'tab-home') navItems[0].classList.add('active');
    if (tabId === 'tab-tasks') navItems[1].classList.add('active');
    if (tabId === 'tab-withdraw') navItems[2].classList.add('active');
}

// 3. Logic xử lý sự kiện xem ADS nhận xu thưởng
const watchAdBtn = document.getElementById("btn-watch-ad");

watchAdBtn.addEventListener("click", () => {
    // Tích hợp mã script nạp quảng cáo Monetag thực tế của ông ở đây
    
    // Xử lý giả lập hành động xem video trong 5 giây:
    watchAdBtn.innerText = "⏳ ĐANG PHÁT QUẢNG CÁO...";
    watchAdBtn.disabled = true;
    
    setTimeout(() => {
        // Sau 5 giây chạy xong, đóng gói data gửi về cho Backend xử lý cộng Xu
        const payload = JSON.stringify({
            action: "ads_completed",
            xu: 1000 // Điền số xu thưởng ông muốn cho mỗi lượt xem
        });
        
        // Bắn tín hiệu ngầm về cho bot.py hứng (Hàm handle_webapp_data đã viết ở backend)
        tg.sendData(payload);
    }, 5000);
});

// Nút tương tác chuyển đổi nhanh danh sách nhiệm vụ vượt link từ trang chủ sang tab 2
document.getElementById("btn-list-tasks").addEventListener("click", () => {
    switchTab('tab-tasks');
});

// Nút Kích hoạt đào free 4H báo cáo alert tương tác
document.getElementById("btn-activate-mining").addEventListener("click", () => {
    tg.showAlert("Yêu cầu kích hoạt máy đào đã gửi! Vui lòng thao tác qua các phím Inline trong khung chat bot để đồng bộ hóa thời gian chính xác.");
});