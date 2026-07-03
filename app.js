const tg = window.Telegram.WebApp;
tg.expand();

// ⚠️ QUAN TRỌNG: Điền địa chỉ IP hoặc Domain VPS chạy bot của ông vào đây
const API_URL = "https://irritant-dwarf-starlit.ngrok-free.dev/api/data";
const userId = tg.initDataUnsafe?.user?.id || 0; 

// --- CÁC BIẾN TOÀN CỤC ---
let miningInterval;
let userAdsWatched = 0;     // Số ads đã xem
let userLinksCompleted = 0; // Số link đã vượt
let dailySpins = 0;         // Số lần đã quay hôm nay
const MAX_DAILY_SPINS = 5;  // Giới hạn 5 lần/ngày
let currentXu = 0;       // Lưu số xu hiện tại
let miningSpeed = 0;     // Tốc độ đào (Xu/giờ)
let fractionalXu = 0;    // Số dư lẻ thập phân để cộng dồn mỗi giây
let currentTasksState = {}; // Biến này để theo dõi xem link nào đã làm, link nào chưa
let isSyncing = false;

// Hàm hiển thị thông báo xịn
function showToast(message, type = 'success') {
    // Rung điện thoại nhẹ cho sướng tay
    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type);
    
    let icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';

    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// ================= HÀM KẾT NỐI API LẤY DATA THẬT =================
async function loadRealData() {
    if (!userId) {
        tg.showAlert("Ko lấy đc ID Telegram từ WebApp!");
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}?user_id=${userId}`, {
            headers: {
                "ngrok-skip-browser-warning": "true"
            }
        });
        const data = await response.json();
        
        if (data.error) {
            console.error("Lỗi API:", data.error);
            return;
        }

        currentXu = data.user.xu;
        miningSpeed = data.user.speed;
        fractionalXu = 0;
        
        // 1. Cập nhật thông tin Tài khoản & Ví tiền thật
        document.getElementById("user-name").innerText = data.user.username ? `@${data.user.username}` : "Ẩn danh";
        document.getElementById("user-level").innerText = `Lv ${data.user.level}`;
        document.getElementById("user-exp").innerText = data.user.level >= 20 ? "MAX LEVEL" : `${data.user.exp}/${data.user.exp_required}`;
        document.getElementById("mining-speed").innerText = `${data.user.speed.toLocaleString()} Xu/giờ`;
        
        document.getElementById("xu-balance").innerText = data.user.xu.toLocaleString();
        document.getElementById("vnd-balance").innerText = (data.user.xu / 100).toLocaleString();
        
        // 2. Đồng bộ số liệu nhiệm vụ để tính lượt quay cho Vòng Quay
        const completedLinksCount = data.tasks.filter(t => t.completed).length;
        document.getElementById("display-links").innerText = completedLinksCount;
        userLinksCompleted = completedLinksCount; // Gán vào biến vòng quay
        
        // 3. Chạy đếm ngược máy đào realtime
        startMiningTimer(data.user.mining_end_time);
        
        // 4. Đổ dữ liệu thật vào Bảng Xếp Hạng
        renderLeaderboard(data.leaderboard);
        
        // 5. Đổ dữ liệu thật vào Danh Sách Nhiệm Vụ
        data.tasks.forEach(t => {
            currentTasksState[t.id] = t.completed;
        });
        renderTaskList(data.tasks);
        
    } catch (err) {
        console.error("Lỗi khi kết nối API Server:", err);
    }
}

function startMiningTimer(endTimeStr) {
    const timeElement = document.getElementById("mining-time");
    const btnActivate = document.getElementById("btn-activate-mining");

    // Nếu ko có thời gian hoặc đang dừng
    if (!endTimeStr || endTimeStr === "None") {
        timeElement.innerText = "00:00:00 (Đang dừng)";
        timeElement.classList.add("time-stopped");
        
        // Mở khóa lại nút kích hoạt
        if (btnActivate) {
            btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO FREE (4H)";
            btnActivate.disabled = false;
            btnActivate.style.opacity = "1";
            btnActivate.classList.remove("btn-gray"); // Bỏ màu xám (nếu có)
        }
        return;
    }
    
    // Khắc phục lệch định dạng múi giờ giữa Python và JS
    const safeDateStr = endTimeStr.replace(" ", "T"); 
    const endTime = new Date(safeDateStr).getTime();
    
    clearInterval(miningInterval);
    miningInterval = setInterval(() => {
        const distance = endTime - new Date().getTime();
        
        // HẾT GIỜ ĐÀO
        if (distance <= 0) {
            clearInterval(miningInterval);
            timeElement.innerText = "00:00:00 (Đang dừng)";
            timeElement.classList.add("time-stopped");
            
            // Trả lại nút kích hoạt
            if (btnActivate) {
                btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO FREE (4H)";
                btnActivate.disabled = false;
                btnActivate.style.opacity = "1";
            }
            return;
        }
        
        // ĐANG TRONG THỜI GIAN ĐÀO
        if (btnActivate) {
            btnActivate.innerHTML = "<i class='fa-solid fa-hammer fa-bounce'></i> ĐANG ĐÀO...";
            btnActivate.disabled = true;
            btnActivate.style.opacity = "0.7";
            btnActivate.style.background = "#475569"; // Đổi sang màu xám cho đúng chuẩn nút đang bị vô hiệu hóa
        }

        timeElement.classList.remove("time-stopped");
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        timeElement.innerText = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
        
        // LOGIC TĂNG XU REALTIME
        if (miningSpeed > 0) {
            fractionalXu += miningSpeed / 3600; // Tốc độ chia cho 3600 giây
            if (fractionalXu >= 1) {
                const addXu = Math.floor(fractionalXu);
                currentXu += addXu;
                fractionalXu -= addXu; // Giữ lại phần lẻ
                
                // Cập nhật giao diện
                document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString(); // RATE = 100
            }
        }
    }, 1000);
}

// ================= HÀM ĐIỀU HƯỚNG 4 TAB =================
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active');
    }
    
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    const order = ['tab-home', 'tab-tasks', 'tab-utils', 'tab-withdraw'];
    const idx = order.indexOf(tabId);
    if(idx !== -1) document.querySelectorAll('.nav-item')[idx].classList.add('active');
}

// ================= ADSGRAM INTEGRATION =================
const AdController = window.Adsgram.init({ blockId: "36819" });
const watchAdBtn = document.getElementById("btn-watch-ad");

if (watchAdBtn) {
    watchAdBtn.addEventListener("click", () => {
        watchAdBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        watchAdBtn.disabled = true;

        AdController.show().then(async (result) => {
            userAdsWatched++;
            
            const displayAdsEl = document.getElementById("display-ads");
            if (displayAdsEl) displayAdsEl.innerText = userAdsWatched;

            // Báo hiệu đang chờ server xử lý cộng tiền
            watchAdBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG NHẬN THƯỞNG...";

            try {
                // Gọi API nhận thưởng
                const adUrl = API_URL.replace('/api/data', '/api/watch_ad') + `?user_id=${userId}`;
                const response = await fetch(adUrl, {
                    method: 'POST',
                    headers: { "ngrok-skip-browser-warning": "true" }
                });
                const data = await response.json();

                if (data.success) {
                    // 1. Cập nhật số Xu mới (cộng thẳng vào biến realtime của máy đào)
                    currentXu = data.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();

                    // 2. Cập nhật EXP hiển thị lên thẻ Tài Khoản
                    const levelText = document.getElementById("user-level").innerText;
                    if (!levelText.includes("20") && !levelText.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${data.new_exp}/${data.exp_required}`;
                    }

                    tg.showAlert(`🎉 Đỉnh chóp! Ông vừa húp trọn ${data.reward_xu} Xu và ${data.reward_exp} EXP.`);
                }
            } catch (err) {
                console.error("Lỗi API Ads:", err);
                tg.showAlert("❌ Có lỗi mạng khi cộng thưởng, ông check lại đường truyền nhé!");
            }

            // Khôi phục nút bấm
            watchAdBtn.innerHTML = "<i class='fa-solid fa-tv'></i> XEM QUẢNG CÁO";
            watchAdBtn.disabled = false;

        }).catch((error) => {
            tg.showAlert("❌ Ông tắt quảng cáo sớm quá nên chưa đc nhận thưởng đâu nha!");
            watchAdBtn.innerHTML = "<i class='fa-solid fa-tv'></i> XEM QUẢNG CÁO";
            watchAdBtn.disabled = false;
        });
    });
}

// Nút kích hoạt máy đào
const btnActivate = document.getElementById("btn-activate-mining");
if (btnActivate) {
    btnActivate.addEventListener("click", () => {
        if (!userId) {
            return tg.showAlert("Ko tìm thấy ID User Telegram!");
        }

        // Đổi trạng thái sang chờ xem ads
        btnActivate.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        btnActivate.disabled = true;

        // Bắt đầu show quảng cáo
        AdController.show().then(async (result) => {
            // Xem xong thì đổi chữ và gọi API kích hoạt
            btnActivate.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG KHỞI ĐỘNG MÁY...";
            
            try {
                // Link API claim_free mà tôi đã hướng dẫn ông làm lúc trước
                const claimUrl = API_URL.replace('/api/data', '/api/claim_free') + `?user_id=${userId}`;
                
                const response = await fetch(claimUrl, {
                    method: 'POST',
                    headers: { "ngrok-skip-browser-warning": "true" }
                });
                const data = await response.json();
                
                if (data.error) {
                    tg.showAlert(data.error);
                    // Nếu lỗi (vd: chưa tới ngày mới), trả lại nút
                    btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO FREE (4H)";
                    btnActivate.disabled = false;
                } else if (data.success) {
                    tg.showAlert("🎉 Xem quảng cáo thành công! Máy đào đã chạy.");
                    // Chạy đếm ngược (hàm bên trên sẽ tự động khóa nút và nhảy chữ ĐANG ĐÀO)
                    startMiningTimer(data.new_end_time);
                }
            } catch (err) {
                console.error("Lỗi API Kích hoạt:", err);
                tg.showAlert("❌ Lỗi kết nối đến server máy chủ!");
                btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO FREE (4H)";
                btnActivate.disabled = false;
            }

        }).catch((error) => {
            // Trường hợp user ấn tắt quảng cáo giữa chừng hoặc lỗi load ads
            tg.showAlert("❌ Ông chưa xem xong quảng cáo hoặc lỗi mạng. Kích hoạt bị hủy!");
            btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO FREE (4H)";
            btnActivate.disabled = false;
        });
    });
}

// ================= LOGIC VÒNG QUAY MAY MẮN (INLINE) =================
const btnLuckyWheel = document.getElementById("btn-lucky-wheel");
const utilsButtonsContainer = document.getElementById("utils-buttons-container");
const inlineWheelContainer = document.getElementById("inline-wheel-container");
const btnBackUtils = document.getElementById("btn-back-utils");
const btnSpin = document.getElementById("btn-spin");
const wheel = document.getElementById("lucky-wheel");
const resultDiv = document.getElementById("wheel-result");

const prizes = [
    "100 Xu", "50 EXP", "200 Xu", "10 EXP", "500 Xu",
    "100 EXP", "50 Xu", "20 EXP", "1000 Xu", "200 EXP"
];

let currentRotation = 0;
let isSpinning = false;

if (btnLuckyWheel) {
    btnLuckyWheel.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineWheelContainer.style.display = "block";
    });
}

if (btnBackUtils) {
    btnBackUtils.addEventListener("click", () => {
        if (isSpinning) return; 
        inlineWheelContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
        if(resultDiv) resultDiv.style.opacity = "0"; 
    });
}

if (btnSpin) {
    btnSpin.addEventListener("click", () => {
        if (isSpinning) return;

        if (dailySpins >= MAX_DAILY_SPINS) {
            tg.showAlert("🛑 Hôm nay ông đã quay hết 5 lần rồi! Hãy quay lại vào ngày mai nhé.");
            return;
        }

        if (userLinksCompleted < 1 && userAdsWatched < 3) {
            tg.showAlert(`⚠️ Chưa đủ điều kiện!\n\nÔng cần vượt thành công 1 Link (đã có: ${userLinksCompleted}) HOẶC xem 3 Quảng Cáo (đã có: ${userAdsWatched}) để đổi 1 lượt quay.`);
            return;
        }

        if (userLinksCompleted >= 1) {
            userLinksCompleted -= 1; 
        } else {
            userAdsWatched -= 3; 
        }

        // Cập nhật lại số liệu hiển thị vé quay sau khi trừ
        if(document.getElementById("display-links")) document.getElementById("display-links").innerText = userLinksCompleted;
        if(document.getElementById("display-ads")) document.getElementById("display-ads").innerText = userAdsWatched;

        dailySpins++;
        isSpinning = true;
        if(resultDiv) resultDiv.style.opacity = "0";
        
        const prizeIndex = Math.floor(Math.random() * 10);
        const spinSpins = 5; 
        const targetDeg = 360 - (prizeIndex * 36 + 18);
        
        currentRotation += (spinSpins * 360) + targetDeg - (currentRotation % 360);
        
        btnSpin.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG QUAY...";
        btnSpin.style.opacity = "0.7";
        
        wheel.style.transform = `rotate(${currentRotation}deg)`;
        
        setTimeout(async () => {
            isSpinning = false;
            btnSpin.innerHTML = "<i class='fa-solid fa-rotate-right'></i> QUAY";
            btnSpin.style.opacity = "1";
            
            if(resultDiv) {
                resultDiv.innerHTML = `🎉 Chúc mừng trúng: <span style="color: var(--color-gold); font-size: 16px;">${prizes[prizeIndex]}</span>!<br><span style="font-size: 12px; color: var(--text-muted);">Lượt quay hôm nay: ${dailySpins}/${MAX_DAILY_SPINS}</span>`;
                resultDiv.style.opacity = "1";
            }
            
            // Xử lý chuỗi để lấy đúng con số Xu/EXP
            let thuongXu = prizes[prizeIndex].includes("Xu") ? parseInt(prizes[prizeIndex]) : 0;
            let thuongExp = prizes[prizeIndex].includes("EXP") ? parseInt(prizes[prizeIndex]) : 0;
            
            // Gọi API nhận thưởng
            try {
                const wheelUrl = API_URL.replace('/api/data', '/api/wheel');
                const res = await fetch(wheelUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ user_id: userId, xu: thuongXu, exp: thuongExp })
                });
                const d = await res.json();
                
                if(d.success) {
                    currentXu = d.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                    
                    const lvl = document.getElementById("user-level").innerText;
                    if(!lvl.includes("20") && !lvl.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${d.new_exp}/${d.exp_required}`;
                    }
                }
            } catch(e) { console.error("Lỗi API Vòng quay:", e); }
            
        }, 4000);
    });
}

// ================= LOGIC RENDER BẢNG XẾP HẠNG REALTIME =================
const btnLeaderboard = document.getElementById("btn-leaderboard");
const inlineLeaderboardContainer = document.getElementById("inline-leaderboard-container");
const btnBackLeaderboard = document.getElementById("btn-back-leaderboard");

function renderLeaderboard(leaderboardData) {
    const leaderboardList = document.getElementById("leaderboard-list");
    if (!leaderboardList) return;
    leaderboardList.innerHTML = "";

    leaderboardData.forEach((user) => {
        let rankIcon = user.rank === 1 ? "🥇" : user.rank === 2 ? "🥈" : user.rank === 3 ? "🥉" : `<span style='display: inline-block; width: 20px; text-align: left; color: var(--text-muted); font-weight: bold;'>${user.rank}.</span>`;
        let displayName = user.name === "Ẩn danh" ? user.name : `@${user.name}`;

        const li = document.createElement("li");
        if (user.rank === 10) {
            li.style.borderBottom = "none";
            li.style.paddingBottom = "0";
        }

        li.style.display = "grid";
        li.style.gridTemplateColumns = "45% 20% 35%";
        li.style.alignItems = "center";
        li.style.gap = "5px";

        li.innerHTML = `
            <div style="display: flex; align-items: center; overflow: hidden; white-space: nowrap;">
                <span style="margin-right: 6px; font-size: 15px;">${rankIcon}</span> 
                <span style="font-weight: 600; color: var(--text-main); font-size: 13px; text-overflow: ellipsis; overflow: hidden;">${displayName}</span>
            </div>
            <div style="text-align: center; color: var(--color-blue); font-size: 13px; font-weight: 600;">Lv ${user.level}</div>
            <div style="text-align: right; color: var(--color-gold); font-size: 13px; font-weight: 700;">${user.xu.toLocaleString()} Xu</div>
        `;
        leaderboardList.appendChild(li);
    });
}

if (btnLeaderboard) {
    const newBtnLeaderboard = btnLeaderboard.cloneNode(true);
    btnLeaderboard.parentNode.replaceChild(newBtnLeaderboard, btnLeaderboard);
    newBtnLeaderboard.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineLeaderboardContainer.style.display = "block";
    });
}

if (btnBackLeaderboard) {
    btnBackLeaderboard.addEventListener("click", () => {
        inlineLeaderboardContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
    });
}

// ================= LOGIC MỜI BẠN BÈ =================
const btnInvite = document.getElementById("btn-invite-friend");
const inlineInviteContainer = document.getElementById("inline-invite-container");
const btnBackInvite = document.getElementById("btn-back-invite");
const btnShareLink = document.getElementById("btn-share-link");
const invitedCountDisplay = document.getElementById("invited-count");

let invitedCount = 0; 

if (btnInvite) {
    const newBtnInvite = btnInvite.cloneNode(true);
    btnInvite.parentNode.replaceChild(newBtnInvite, btnInvite);
    newBtnInvite.addEventListener("click", () => {
        if (invitedCountDisplay) invitedCountDisplay.innerText = invitedCount;
        utilsButtonsContainer.style.display = "none";
        inlineInviteContainer.style.display = "block";
    });
}

if (btnBackInvite) {
    btnBackInvite.addEventListener("click", () => {
        inlineInviteContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
    });
}

if (btnShareLink) {
    btnShareLink.addEventListener("click", () => {
        const botUsername = "Farmcoinvn2026_bot"; 
        const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
        const shareText = "🔥 Vào cày Xu đào coin Mini App cực bốc cùng mình nhận ngay 5,000 Xu, 50 EXP và 3 lượt quay miễn phí nhé!";
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;
        tg.openTelegramLink(shareUrl);
    });
}

// ================= LOGIC ĐIỂM DANH HÀNG NGÀY =================
const btnDailyAttendance = document.getElementById("btn-daily-attendance");
const inlineAttendanceContainer = document.getElementById("inline-attendance-container");
const btnBackAttendance = document.getElementById("btn-back-attendance");
const btnDoAttendance = document.getElementById("btn-do-attendance");

let hasAttendedToday = false; 

if (btnDailyAttendance) {
    btnDailyAttendance.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineAttendanceContainer.style.display = "block";
    });
}

if (btnBackAttendance) {
    btnBackAttendance.addEventListener("click", () => {
        inlineAttendanceContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
    });
}

if (btnDoAttendance) {
    btnDoAttendance.addEventListener("click", () => {
        if (hasAttendedToday) {
            tg.showAlert("Hôm nay bạn đã điểm danh rồi! Hãy quay lại vào ngày mai nhé.");
            return;
        }

        btnDoAttendance.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG XỬ LÝ...";
        btnDoAttendance.disabled = true;

        setTimeout(async () => {
            hasAttendedToday = true;
            btnDoAttendance.innerHTML = "<i class='fa-solid fa-check'></i> ĐÃ ĐIỂM DANH";
            btnDoAttendance.style.opacity = "0.7";
            
            const today = new Date().getDay(); 
            const currentDayLi = document.querySelector(`#attendance-list li[data-day="${today}"]`);
            if (currentDayLi) {
                const statusIcon = currentDayLi.querySelector(".status-icon");
                if (statusIcon) statusIcon.innerHTML = "<i class='fa-solid fa-circle-check' style='color: var(--color-mint); margin-left: 8px; font-size: 16px;'></i>";
                currentDayLi.style.background = "rgba(52, 211, 153, 0.1)";
                currentDayLi.style.borderRadius = "8px";
                currentDayLi.style.padding = "8px";
                currentDayLi.style.borderBottom = "none";
            }

            // Gọi API Điểm danh
            try {
                const attUrl = API_URL.replace('/api/data', '/api/attendance');
                const res = await fetch(attUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ user_id: userId })
                });
                const d = await res.json();
                
                if(d.success) {
                    currentXu = d.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                    
                    const lvl = document.getElementById("user-level").innerText;
                    if(!lvl.includes("20") && !lvl.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${d.new_exp}/${d.exp_required}`;
                    }
                    tg.showAlert(`🎉 Điểm danh thành công! Ông nhận được ${d.reward_xu} Xu và ${d.reward_exp} EXP.`);
                }
            } catch(e) { console.error("Lỗi API Điểm danh:", e); }
            
        }, 800);
    });
}

// ================= LOGIC RENDER DANH SÁCH LINK NHIỆM VỤ REALTIME =================
function renderTaskList(tasksData) {
    const container = document.getElementById("task-list-container");
    if (!container) return; 

    container.innerHTML = ""; 
    let completedCount = 0;

    tasksData.forEach((task, index) => {
        const isCompleted = task.completed;
        const statusText = isCompleted ? "thành công" : "chưa làm";
        if (isCompleted) completedCount++;

        const taskHTML = `
            <div class="simple-task-item">
                <div class="simple-task-text">Link ${index + 1}: <a href="${task.link}" target="_blank" style="color: var(--color-blue); text-decoration: underline;">${task.link}</a></div>
                <div class="simple-task-text">Trạng thái: <span class="${isCompleted ? 'status-completed' : 'status-pending'}">${statusText}</span></div>
            </div>
        `;
        container.innerHTML += taskHTML;
    });

    const progressEl = document.getElementById("task-progress");
    if (progressEl) {
        progressEl.innerText = `${completedCount}/${tasksData.length}`;
    }
}

// ================= LOGIC RÚT TIỀN (MINI APP) =================
const wdMethodContainer = document.getElementById("wd-method-container");
const wdFormBank = document.getElementById("wd-form-bank");
const wdFormMomo = document.getElementById("wd-form-momo");

const btnWdBank = document.getElementById("btn-wd-bank");
const btnWdMomo = document.getElementById("btn-wd-momo");
// ================= XỬ LÝ NÚT QUAY LẠI PHẦN RÚT TIỀN =================
const btnsBackWd = document.querySelectorAll(".btn-back-wd");

if (btnsBackWd.length > 0) {
    btnsBackWd.forEach(btn => {
        btn.addEventListener("click", () => {
            // Ẩn 2 form nhập liệu đi
            if (wdFormBank) wdFormBank.style.display = "none";
            if (wdFormMomo) wdFormMomo.style.display = "none";
            // Hiện lại form chọn phương thức ban đầu
            if (wdMethodContainer) wdMethodContainer.style.display = "block";
        });
    });
}

const btnSubmitBank = document.getElementById("btn-submit-bank");
const btnSubmitMomo = document.getElementById("btn-submit-momo");

if (btnWdBank && btnWdMomo) {
    btnWdBank.addEventListener("click", () => {
        wdMethodContainer.style.display = "none";
        wdFormBank.style.display = "block";
        
        // Nhét số Xu và VNĐ vào form Ngân Hàng
        if (document.getElementById("wd-bank-xu")) {
            document.getElementById("wd-bank-xu").innerText = currentXu.toLocaleString();
            document.getElementById("wd-bank-vnd").innerText = (currentXu / 100).toLocaleString();
        }
    });

    btnWdMomo.addEventListener("click", () => {
        wdMethodContainer.style.display = "none";
        wdFormMomo.style.display = "block";
        
        // Nhét số Xu và VNĐ vào form Momo
        if (document.getElementById("wd-momo-xu")) {
            document.getElementById("wd-momo-xu").innerText = currentXu.toLocaleString();
            document.getElementById("wd-momo-vnd").innerText = (currentXu / 100).toLocaleString();
        }
    });
}

// ================= XỬ LÝ GỬI LỆNH RÚT NGÂN HÀNG =================
if (btnSubmitBank) {
    btnSubmitBank.addEventListener("click", async () => {
        const amount = parseInt(document.getElementById("bank-amount").value);
        const bankName = document.getElementById("bank-name").value.trim();
        const stk = document.getElementById("bank-stk").value.trim();
        const fullName = document.getElementById("bank-fullname").value.trim();

        if (!amount || amount < 2000 || amount > 10000) {
            return tg.showAlert("Số tiền rút phải từ 2,000 đến 10,000 VNĐ!");
        }
        if (!bankName || !stk || !fullName) {
            return tg.showAlert("Vui lòng điền đầy đủ thông tin Ngân hàng!");
        }

        const formatInfo = `${bankName} - ${stk} - ${fullName.toUpperCase()}`;
        const userName = tg.initDataUnsafe?.user?.username || tg.initDataUnsafe?.user?.first_name || "Ẩn danh";
        
        btnSubmitBank.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG XỬ LÝ...";
        btnSubmitBank.disabled = true;

        try {
            const wdUrl = API_URL.replace('/api/data', '/api/withdraw');
            const res = await fetch(wdUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                body: JSON.stringify({
                    user_id: userId,
                    amount_vnd: amount,
                    method: "Ngân Hàng",
                    info: formatInfo,
                    username: userName
                })
            });
            const data = await res.json();

            if (data.error) {
                tg.showAlert("❌ " + data.error);
            } else if (data.success) {
                // Trừ tiền trên giao diện tức thì
                currentXu = data.new_xu;
                document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                
                tg.showAlert("✅ Lệnh rút đã được gửi! Admin đang xem xét duyệt, ông chú ý check tin nhắn bot nhé.");
                
                // Trả về màn hình chọn phương thức & Xóa trắng form
                wdFormBank.style.display = "none";
                wdMethodContainer.style.display = "block";
                document.getElementById("bank-amount").value = "";
                document.getElementById("bank-name").value = "";
                document.getElementById("bank-stk").value = "";
                document.getElementById("bank-fullname").value = "";
            }
        } catch (err) {
            tg.showAlert("❌ Lỗi kết nối mạng, vui lòng thử lại sau!");
        }

        btnSubmitBank.innerHTML = "<i class='fa-solid fa-paper-plane'></i> GỬI LỆNH RÚT";
        btnSubmitBank.disabled = false;
    });
}

// ================= XỬ LÝ GỬI LỆNH RÚT MOMO =================
if (btnSubmitMomo) {
    btnSubmitMomo.addEventListener("click", async () => {
        const amount = parseInt(document.getElementById("momo-amount").value);
        const phone = document.getElementById("momo-phone").value.trim();
        const fullName = document.getElementById("momo-fullname").value.trim();

        if (!amount || amount < 2000 || amount > 10000) {
            return tg.showAlert("Số tiền rút phải từ 2,000 đến 10,000 VNĐ!");
        }
        if (!phone || !fullName) {
            return tg.showAlert("Vui lòng điền đầy đủ số điện thoại và tên!");
        }

        const formatInfo = `${phone} - ${fullName.toUpperCase()}`;
        const userName = tg.initDataUnsafe?.user?.username || tg.initDataUnsafe?.user?.first_name || "Ẩn danh";
        
        btnSubmitMomo.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG XỬ LÝ...";
        btnSubmitMomo.disabled = true;

        try {
            const wdUrl = API_URL.replace('/api/data', '/api/withdraw');
            const res = await fetch(wdUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                body: JSON.stringify({
                    user_id: userId,
                    amount_vnd: amount,
                    method: "Momo",
                    info: formatInfo,
                    username: userName
                })
            });
            const data = await res.json();

            if (data.error) {
                tg.showAlert("❌ " + data.error);
            } else if (data.success) {
                currentXu = data.new_xu;
                document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                
                tg.showAlert("✅ Lệnh rút đã được gửi! Admin đang xem xét duyệt, ông chú ý check tin nhắn bot nhé.");
                
                wdFormMomo.style.display = "none";
                wdMethodContainer.style.display = "block";
                document.getElementById("momo-amount").value = "";
                document.getElementById("momo-phone").value = "";
                document.getElementById("momo-fullname").value = "";
            }
        } catch (err) {
            tg.showAlert("❌ Lỗi kết nối mạng, vui lòng thử lại sau!");
        }

        btnSubmitMomo.innerHTML = "<i class='fa-solid fa-paper-plane'></i> GỬI LỆNH RÚT";
        btnSubmitMomo.disabled = false;
    });
}
// ================= TỰ ĐỘNG KÍCH HOẠT KHI MỞ MÀN HÌNH =================
loadRealData();

// ================= HÀM ĐỒNG BỘ DỮ LIỆU NGẦM (DÀNH CHO VƯỢT LINK) =================
async function syncData() {
    if (!userId || isSyncing) return;
    isSyncing = true;
    
    try {
        const response = await fetch(`${API_URL}?user_id=${userId}`, {
            headers: { "ngrok-skip-browser-warning": "true" }
        });
        const data = await response.json();
        if (data.error) return;

        let newlyCompleted = 0;
        
        data.tasks.forEach(task => {
            if (task.completed === true && currentTasksState[task.id] === false) {
                newlyCompleted++;
            }
            currentTasksState[task.id] = task.completed; 
        });

        if (newlyCompleted > 0) {
            tg.showAlert(`🎉 Đỉnh quá! Ông vừa vượt thành công ${newlyCompleted} Link. Phần thưởng Xu và EXP đã được cộng vào ví!`);
            
            currentXu = data.user.xu;
            document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
            document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
            
            const levelText = document.getElementById("user-level").innerText;
            if (!levelText.includes("20") && !levelText.includes("MAX")) {
                document.getElementById("user-exp").innerText = `${data.user.exp}/${data.user.exp_required}`;
            }

            const completedLinksCount = data.tasks.filter(t => t.completed).length;
            const displayLinks = document.getElementById("display-links");
            if (displayLinks) displayLinks.innerText = completedLinksCount;
            userLinksCompleted = completedLinksCount;
        }

        renderTaskList(data.tasks);

    } catch (err) {
        console.error("Lỗi đồng bộ ngầm:", err);
    } finally {
        isSyncing = false; 
    }
}

window.addEventListener('focus', syncData);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncData();
});

setTimeout(() => {
    const watchAdBtn = document.getElementById("btn-watch-ad");
    if (watchAdBtn && !document.getElementById("btn-refresh-tasks")) {
        const refreshBtn = document.createElement("button");
        refreshBtn.id = "btn-refresh-tasks";
        refreshBtn.className = "btn-mint"; 
        refreshBtn.style.marginTop = "10px";
        refreshBtn.innerHTML = "<i class='fa-solid fa-rotate'></i> LÀM MỚI TRẠNG THÁI LINK";
        
        refreshBtn.onclick = () => {
            refreshBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG LÀM MỚI...";
            refreshBtn.style.opacity = "0.7";
            syncData().then(() => {
                refreshBtn.innerHTML = "<i class='fa-solid fa-rotate'></i> LÀM MỚI TRẠNG THÁI LINK";
                refreshBtn.style.opacity = "1";
            });
        };
        watchAdBtn.parentNode.insertBefore(refreshBtn, watchAdBtn.nextSibling);
    }
}, 1000);
