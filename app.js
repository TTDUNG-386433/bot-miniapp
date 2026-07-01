const tg = window.Telegram.WebApp;
tg.expand();

// 1. Nạp thông tin user
// 1. Nạp thông tin user từ Telegram
if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const user = tg.initDataUnsafe.user;
    // Ưu tiên username, nếu ko có thì lấy first_name, nếu ko có nữa thì "Ẩn danh"
    let displayName = user.username ? `@${user.username}` : (user.first_name || "Ẩn danh");
    document.getElementById("user-name").innerText = displayName;
}

// 2. Hàm điều hướng 4 tab
// 2. Hàm điều hướng 4 tab đã được tối ưu
function switchTab(tabId) {
    // Tắt tất cả tab hiện tại
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Bật tab được chọn (CSS Animation sẽ tự động chạy)
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active');
    }
    
    // Cập nhật trạng thái nút nav (Thanh điều hướng dưới cùng)
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    const order = ['tab-home', 'tab-tasks', 'tab-utils', 'tab-withdraw'];
    const idx = order.indexOf(tabId);
    if(idx !== -1) document.querySelectorAll('.nav-item')[idx].classList.add('active');
}


// Khởi tạo Adsgram Controller với UnitID của ông
const AdController = window.Adsgram.init({ blockId: "36819" });

const watchAdBtn = document.getElementById("btn-watch-ad");

// --- CÁC BIẾN LƯU TRỮ ĐIỀU KIỆN QUAY ---
let userAdsWatched = 0;     // Số ads đã xem
let userLinksCompleted = 0; // Số link đã vượt
let dailySpins = 0;         // Số lần đã quay hôm nay
const MAX_DAILY_SPINS = 5;  // Giới hạn 5 lần/ngày
// -----------------------------------------------------------

if (watchAdBtn) {
    watchAdBtn.addEventListener("click", () => {
        watchAdBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        watchAdBtn.disabled = true;

        // Gọi hàm show() để bật video quảng cáo
        AdController.show().then((result) => {
            // User XEM XONG video (không tắt ngang)
            userAdsWatched++;
            
            // Cập nhật số liệu hiển thị trên giao diện (nếu ông có ID display-ads)
            const displayAdsEl = document.getElementById("display-ads");
            if (displayAdsEl) displayAdsEl.innerText = userAdsWatched;

            tg.showAlert(`Đã xem xong quảng cáo! (Tiến độ vé quay: ${userAdsWatched}/3 Ads)`);
            
            // Bắn data ngầm về cho bot.py hứng để cộng tiền
            const payload = JSON.stringify({
                action: "ads_completed",
                xu: 1000 
            });
            tg.sendData(payload); 
            
            // Trả lại trạng thái nút
            watchAdBtn.innerHTML = "<i class='fa-solid fa-tv'></i> XEM QUẢNG CÁO (+Xu Thưởng)";
            watchAdBtn.disabled = false;

        }).catch((error) => {
            // User TẮT NGANG video hoặc lỗi mạng không tải được
            tg.showAlert("Quảng cáo đã bị đóng hoặc lỗi kết nối. Chưa nhận được phần thưởng!");
            
            // Trả lại trạng thái nút
            watchAdBtn.innerHTML = "<i class='fa-solid fa-tv'></i> XEM QUẢNG CÁO (+Xu Thưởng)";
            watchAdBtn.disabled = false;
        });
    });
}

// Nút kích hoạt máy đào
const btnActivate = document.getElementById("btn-activate-mining");
if (btnActivate) {
    btnActivate.addEventListener("click", () => {
        tg.showAlert("Yêu cầu kích hoạt máy đào đã gửi! Vui lòng thao tác qua các phím Inline trong khung chat bot để đồng bộ hóa thời gian chính xác.");
    });
}

// ================= KẾT NỐI SỰ KIỆN CHO CÁC NÚT TIỆN ÍCH =================

// ================= LOGIC VÒNG QUAY MAY MẮN (INLINE) =================
const btnLuckyWheel = document.getElementById("btn-lucky-wheel");
const utilsButtonsContainer = document.getElementById("utils-buttons-container");
const inlineWheelContainer = document.getElementById("inline-wheel-container");
const btnBackUtils = document.getElementById("btn-back-utils");
const btnSpin = document.getElementById("btn-spin");
const wheel = document.getElementById("lucky-wheel");
const resultDiv = document.getElementById("wheel-result");

// Mảng 10 phần thưởng tương ứng
const prizes = [
    "100 Xu", "50 EXP", "200 Xu", "10 EXP", "500 Xu",
    "100 EXP", "50 Xu", "20 EXP", "1000 Xu", "200 EXP"
];

let currentRotation = 0;
let isSpinning = false;

// 1. Nhấn nút Vòng Quay -> Ẩn các nút tiện ích, Hiện vòng quay
if (btnLuckyWheel) {
    btnLuckyWheel.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineWheelContainer.style.display = "block";
    });
}

// 2. Nhấn nút Quay Lại -> Ẩn vòng quay, Hiện lại các nút tiện ích
if (btnBackUtils) {
    btnBackUtils.addEventListener("click", () => {
        if (isSpinning) return; // Đang quay thì ko cho thoát
        inlineWheelContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
        // Reset lại chữ kết quả cho lần vào sau
        if(resultDiv) resultDiv.style.opacity = "0"; 
    });
}

// 3. Xử lý logic Quay
// 3. Xử lý logic Quay có điều kiện
if (btnSpin) {
    btnSpin.addEventListener("click", () => {
        if (isSpinning) return;

        // BƯỚC 1: Kiểm tra giới hạn 5 lần/ngày
        if (dailySpins >= MAX_DAILY_SPINS) {
            tg.showAlert("🛑 Hôm nay ông đã quay hết 5 lần rồi! Hãy quay lại vào ngày mai nhé.");
            return;
        }

        // BƯỚC 2: Kiểm tra điều kiện (Có 1 link HOẶC 3 ads)
        if (userLinksCompleted < 1 && userAdsWatched < 3) {
            tg.showAlert(`⚠️ Chưa đủ điều kiện!\n\nÔng cần vượt thành công 1 Link (đã có: ${userLinksCompleted}) HOẶC xem 3 Quảng Cáo (đã có: ${userAdsWatched}) để đổi 1 lượt quay.`);
            return;
        }

        // BƯỚC 3: Đủ điều kiện -> Tiến hành trừ "vé"
        if (userLinksCompleted >= 1) {
            userLinksCompleted -= 1; // Ưu tiên trừ link trước nếu có
        } else {
            userAdsWatched -= 3; // Nếu ko có link thì trừ 3 ads
        }

        // Cộng dồn số lần quay trong ngày
        dailySpins++;
        
        // Bắt đầu hiệu ứng quay
        isSpinning = true;
        if(resultDiv) resultDiv.style.opacity = "0";
        
        const prizeIndex = Math.floor(Math.random() * 10);
        const spinSpins = 5; 
        const targetDeg = 360 - (prizeIndex * 36 + 18);
        
        currentRotation += (spinSpins * 360) + targetDeg - (currentRotation % 360);
        
        btnSpin.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG QUAY...";
        btnSpin.style.opacity = "0.7";
        
        wheel.style.transform = `rotate(${currentRotation}deg)`;
        
        setTimeout(() => {
            isSpinning = false;
            btnSpin.innerHTML = "<i class='fa-solid fa-rotate-right'></i> QUAY";
            btnSpin.style.opacity = "1";
            
            if(resultDiv) {
                resultDiv.innerHTML = `🎉 Chúc mừng trúng: <span style="color: var(--color-gold); font-size: 16px;">${prizes[prizeIndex]}</span>!<br><span style="font-size: 12px; color: var(--text-muted);">Lượt quay hôm nay: ${dailySpins}/${MAX_DAILY_SPINS}</span>`;
                resultDiv.style.opacity = "1";
            }
        }, 4000);
    });
}

// Nút Bảng Xếp Hạng
// ================= LOGIC BẢNG XẾP HẠNG (INLINE) =================
const btnLeaderboard = document.getElementById("btn-leaderboard");
const inlineLeaderboardContainer = document.getElementById("inline-leaderboard-container");
const btnBackLeaderboard = document.getElementById("btn-back-leaderboard");
const leaderboardList = document.getElementById("leaderboard-list");

// Mảng chứa dữ liệu giả lập của 10 người chơi dẫn đầu
// Mảng chứa dữ liệu giả lập của 10 người chơi dẫn đầu (Đã thêm level theo logic bot.py)
const mockLeaderboard = [
    { rank: 1, name: "miner_pro", level: 20, xu: "15,250,000" },
    { rank: 2, name: "crypto_king", level: 19, xu: "12,400,000" },
    { rank: 3, name: "gold_hunter", level: 18, xu: "9,850,000" },
    { rank: 4, name: "lucky_boy", level: 15, xu: "8,100,000" },
    { rank: 5, name: "xu_master", level: 14, xu: "7,500,000" },
    { rank: 6, name: "diamond_click", level: 12, xu: "6,200,000" },
    { rank: 7, name: "daily_farm", level: 11, xu: "5,900,000" },
    { rank: 8, name: "telegram_user", level: 10, xu: "4,800,000" },
    { rank: 9, name: "coin_collector", level: 8, xu: "3,950,000" },
    { rank: 10, name: "Ẩn danh", level: 5, xu: "1,250,000" } // Xử lý logic hiển thị Ẩn danh
];

// Hàm tạo danh sách hiển thị cấu trúc HTML cho bảng xếp hạng
// Hàm tạo danh sách hiển thị cấu trúc HTML cho bảng xếp hạng
function renderLeaderboard() {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = "";

    mockLeaderboard.forEach((user) => {
        let rankIcon = "";
        // Đồng bộ icon huy chương emoji giống bot.py (🥇, 🥈, 🥉)
        if (user.rank === 1) {
            rankIcon = "🥇";
        } else if (user.rank === 2) {
            rankIcon = "🥈";
        } else if (user.rank === 3) {
            rankIcon = "🥉";
        } else {
            rankIcon = `<span style='display: inline-block; width: 20px; text-align: left; color: var(--text-muted); font-weight: bold;'>${user.rank}.</span>`;
        }

        // Logic xử lý tên: Thêm @ đằng trước trừ khi là "Ẩn danh"
        let displayName = user.name === "Ẩn danh" ? user.name : `@${user.name}`;

        const li = document.createElement("li");
        
        if (user.rank === 10) {
            li.style.borderBottom = "none";
            li.style.paddingBottom = "0";
        }

        // Ghi đè thuộc tính flex mặc định để chuyển sang dạng lưới (Grid) 3 cột
        li.style.display = "grid";
        // Cột 1 (Tên) chiếm 45%, Cột 2 (Level) chiếm 20%, Cột 3 (Xu) chiếm 35%
        li.style.gridTemplateColumns = "45% 20% 35%";
        li.style.alignItems = "center";
        li.style.gap = "5px";

        // Cấu trúc HTML 3 cột rõ ràng
        li.innerHTML = `
            <div style="display: flex; align-items: center; overflow: hidden; white-space: nowrap;">
                <span style="margin-right: 6px; font-size: 15px;">${rankIcon}</span> 
                <span style="font-weight: 600; color: var(--text-main); font-size: 13px; text-overflow: ellipsis; overflow: hidden;">${displayName}</span>
            </div>
            
            <div style="text-align: center; color: var(--color-blue); font-size: 13px; font-weight: 600;">
                Lv ${user.level}
            </div>
            
            <div style="text-align: right; color: var(--color-gold); font-size: 13px; font-weight: 700;">
                ${user.xu} Xu
            </div>
        `;
        leaderboardList.appendChild(li);
    });
}

// Tiến hành khởi chạy danh sách ngay khi ứng dụng tải xong
renderLeaderboard();

// 1. Khi nhấn nút Bảng Xếp Hạng ngoài menu chính
if (btnLeaderboard) {
    // Bản sao để loại bỏ các sự kiện tích hợp cũ nếu có
    const newBtnLeaderboard = btnLeaderboard.cloneNode(true);
    btnLeaderboard.parentNode.replaceChild(newBtnLeaderboard, btnLeaderboard);

    newBtnLeaderboard.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineLeaderboardContainer.style.display = "block";
    });
}

// 2. Khi nhấn nút Quay lại từ giao diện bảng xếp hạng
if (btnBackLeaderboard) {
    btnBackLeaderboard.addEventListener("click", () => {
        inlineLeaderboardContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
    });
}

// ================= LOGIC MỜI BẠN BÈ (INLINE) =================
const btnInvite = document.getElementById("btn-invite-friend");
const inlineInviteContainer = document.getElementById("inline-invite-container");
const btnBackInvite = document.getElementById("btn-back-invite");
const btnShareLink = document.getElementById("btn-share-link");
const invitedCountDisplay = document.getElementById("invited-count");

// Biến giả lập số người đã mời (Sau này bạn có thể lấy dữ liệu từ API Python truyền xuống)
let invitedCount = 12; 

// 1. Khi nhấn nút Mời Bạn Bè ngoài menu chính
if (btnInvite) {
    // Tạo bản sao để loại bỏ các sự kiện tích hợp cũ
    const newBtnInvite = btnInvite.cloneNode(true);
    btnInvite.parentNode.replaceChild(newBtnInvite, btnInvite);

    newBtnInvite.addEventListener("click", () => {
        // Cập nhật số lượng người đã mời lên màn hình
        if (invitedCountDisplay) invitedCountDisplay.innerText = invitedCount;
        
        utilsButtonsContainer.style.display = "none";
        inlineInviteContainer.style.display = "block";
    });
}

// 2. Khi nhấn nút Quay lại từ giao diện Mời bạn bè
if (btnBackInvite) {
    btnBackInvite.addEventListener("click", () => {
        inlineInviteContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
    });
}

// 3. Khi nhấn nút Chia sẻ liên kết
// 3. Khi nhấn nút Chia sẻ liên kết
if (btnShareLink) {
    btnShareLink.addEventListener("click", () => {
        const botUsername = "Farmcoinvn2026_bot"; 
        const refLink = `https://t.me/${botUsername}?start=ref_${tg.initDataUnsafe.user?.id || 'id_demo'}`;
        
        // Cập nhật nội dung tin nhắn chia sẻ cho khớp với phần thưởng mới
        const shareText = "🔥 Vào cày Xu đào coin Mini App cực bốc cùng mình nhận ngay 5,000 Xu, 50 EXP và 3 lượt quay miễn phí nhé!";
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;
        
        tg.openTelegramLink(shareUrl);
    });
}

// Nút Điểm Danh Hằng Ngày
// ================= LOGIC ĐIỂM DANH HÀNG NGÀY (INLINE) =================
const btnDailyAttendance = document.getElementById("btn-daily-attendance");
const inlineAttendanceContainer = document.getElementById("inline-attendance-container");
const btnBackAttendance = document.getElementById("btn-back-attendance");
const btnDoAttendance = document.getElementById("btn-do-attendance");

let hasAttendedToday = false; // Biến kiểm tra trạng thái điểm danh hôm nay

// 1. Nhấn nút Điểm Danh ngoài menu -> Ẩn menu, hiện bảng điểm danh
if (btnDailyAttendance) {
    btnDailyAttendance.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineAttendanceContainer.style.display = "block";
    });
}

// 2. Nhấn nút Quay lại -> Ẩn bảng điểm danh, hiện menu
if (btnBackAttendance) {
    btnBackAttendance.addEventListener("click", () => {
        inlineAttendanceContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
    });
}

// 3. Logic xử lý khi nhấn nút ĐIỂM DANH NGAY
if (btnDoAttendance) {
    btnDoAttendance.addEventListener("click", () => {
        // Kiểm tra xem hôm nay đã điểm danh chưa
        if (hasAttendedToday) {
            tg.showAlert("Hôm nay bạn đã điểm danh rồi! Hãy quay lại vào ngày mai nhé.");
            return;
        }

        btnDoAttendance.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG XỬ LÝ...";
        btnDoAttendance.disabled = true;

        setTimeout(() => {
            hasAttendedToday = true;
            btnDoAttendance.innerHTML = "<i class='fa-solid fa-check'></i> ĐÃ ĐIỂM DANH";
            btnDoAttendance.style.opacity = "0.7";
            
            // Lấy ngày hiện tại trong tuần (0 là Chủ nhật, 1 là Thứ 2...)
            const today = new Date().getDay(); 
            
            // Tìm dòng tương ứng với ngày hôm nay để đánh dấu tích xanh
            const currentDayLi = document.querySelector(`#attendance-list li[data-day="${today}"]`);
            if (currentDayLi) {
                const statusIcon = currentDayLi.querySelector(".status-icon");
                if (statusIcon) {
                    statusIcon.innerHTML = "<i class='fa-solid fa-circle-check' style='color: var(--color-mint); margin-left: 8px; font-size: 16px;'></i>";
                }
                // Làm nổi bật nhẹ dòng của ngày hôm nay
                currentDayLi.style.background = "rgba(52, 211, 153, 0.1)";
                currentDayLi.style.borderRadius = "8px";
                currentDayLi.style.padding = "8px";
                currentDayLi.style.borderBottom = "none";
            }

            tg.showAlert("Điểm danh thành công! Bạn đã nhận được phần thưởng của ngày hôm nay.");
            
            // Bắn dữ liệu về cho bot Telegram
            tg.sendData(JSON.stringify({ action: "daily_attendance" }));
        }, 800);
    });
}

// ================= LOGIC RENDER DANH SÁCH LINK NHIỆM VỤ =================

// Mảng giả lập data link (Sau này API từ Python trả về list tương tự thế này)
// ================= LOGIC RENDER DANH SÁCH LINK NHIỆM VỤ =================

// Tạo mảng giả lập 10 link (sau này ông thay bằng API lấy từ Bot)
const mockTasks = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    link: `https://link4m.co/st?api=xxx&url=yyy${i + 1}`,
    status: i < 3 ? "completed" : "pending" // Giả lập 3 link đầu đã làm thành công
}));

function renderTaskList() {
    const container = document.getElementById("task-list-container");
    if (!container) return; 

    container.innerHTML = ""; 
    let completedCount = 0;

    mockTasks.forEach((task, index) => {
        const isCompleted = task.status === "completed";
        const statusText = isCompleted ? "thành công" : "chưa làm";
        
        if (isCompleted) completedCount++;

        // Render HTML giống hệt bố cục ảnh ông gửi
        const taskHTML = `
            <div class="simple-task-item">
                <div class="simple-task-text">Link ${index + 1}: <span style="color: var(--color-blue); text-decoration: underline;">${task.link}</span></div>
                <div class="simple-task-text">Trạng thái: <span class="${isCompleted ? 'status-completed' : 'status-pending'}">${statusText}</span></div>
            </div>
        `;
        container.innerHTML += taskHTML;
    });

    // Cập nhật thanh tiến độ 0/10
    const progressEl = document.getElementById("task-progress");
    if (progressEl) {
        progressEl.innerText = `${completedCount}/${mockTasks.length}`;
    }
}

// Gọi hàm ngay khi app load xong
renderTaskList();

const overlay = document.getElementById("wheel-overlay");

// Gọi hàm này khi nhấn nút ở Tab Tiện ích
function showWheel() {
    overlay.style.display = "flex";
}

// Gọi hàm này khi nhấn nút quay về
function hideWheel() {
    overlay.style.display = "none";
}

// ================= LOGIC RÚT TIỀN (MINI APP) =================
const wdMethodContainer = document.getElementById("wd-method-container");
const wdFormBank = document.getElementById("wd-form-bank");
const wdFormMomo = document.getElementById("wd-form-momo");

const btnWdBank = document.getElementById("btn-wd-bank");
const btnWdMomo = document.getElementById("btn-wd-momo");
const btnsBackWd = document.querySelectorAll(".btn-back-wd");

const btnSubmitBank = document.getElementById("btn-submit-bank");
const btnSubmitMomo = document.getElementById("btn-submit-momo");

// 1. Chuyển hướng Form
if (btnWdBank && btnWdMomo) {
    btnWdBank.addEventListener("click", () => {
        wdMethodContainer.style.display = "none";
        wdFormBank.style.display = "block";
    });

    btnWdMomo.addEventListener("click", () => {
        wdMethodContainer.style.display = "none";
        wdFormMomo.style.display = "block";
    });
}

// 2. Nút Quay Lại
btnsBackWd.forEach(btn => {
    btn.addEventListener("click", () => {
        wdFormBank.style.display = "none";
        wdFormMomo.style.display = "none";
        wdMethodContainer.style.display = "block";
    });
});

// 3. Xử lý Gửi lệnh rút Ngân Hàng
if (btnSubmitBank) {
    btnSubmitBank.addEventListener("click", () => {
        const amount = parseInt(document.getElementById("bank-amount").value);
        const bankName = document.getElementById("bank-name").value.trim();
        const stk = document.getElementById("bank-stk").value.trim();
        const fullName = document.getElementById("bank-fullname").value.trim();

        // Validate dữ liệu
        if (!amount || amount < 2000 || amount > 10000) {
            return tg.showAlert("Số tiền rút phải từ 2,000 đến 10,000 VNĐ!");
        }
        if (!bankName || !stk || !fullName) {
            return tg.showAlert("Vui lòng điền đầy đủ thông tin Ngân hàng!");
        }

        // Tự động ghép chuỗi chuẩn định dạng bot.py: Tên Ngân hàng - STK - Họ Tên
        const formatInfo = `${bankName} - ${stk} - ${fullName.toUpperCase()}`;
        
        // Bắn data về Bot Telegram
        const payload = JSON.stringify({
            action: "withdraw",
            method: "Ngân Hàng",
            amount_vnd: amount,
            info: formatInfo
        });
        tg.sendData(payload);
        tg.close(); // Đóng Mini app để bot chat xử lý tiếp
    });
}

// 4. Xử lý Gửi lệnh rút Momo
if (btnSubmitMomo) {
    btnSubmitMomo.addEventListener("click", () => {
        const amount = parseInt(document.getElementById("momo-amount").value);
        const phone = document.getElementById("momo-phone").value.trim();
        const fullName = document.getElementById("momo-fullname").value.trim();

        if (!amount || amount < 2000 || amount > 10000) {
            return tg.showAlert("Số tiền rút phải từ 2,000 đến 10,000 VNĐ!");
        }
        if (!phone || !fullName) {
            return tg.showAlert("Vui lòng điền đầy đủ số điện thoại và tên!");
        }

        // Tự động ghép chuỗi chuẩn định dạng bot.py: SĐT - Họ Tên
        const formatInfo = `${phone} - ${fullName.toUpperCase()}`;
        
        const payload = JSON.stringify({
            action: "withdraw",
            method: "Momo",
            amount_vnd: amount,
            info: formatInfo
        });
        tg.sendData(payload);
        tg.close();
    });
}
