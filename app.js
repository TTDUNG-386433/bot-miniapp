const tg = window.Telegram.WebApp;
tg.expand();

const BASE_URL = "https://irritant-dwarf-starlit.ngrok-free.dev"; 
const API_URL = `${BASE_URL}/api/data`;
const userId = tg.initDataUnsafe?.user?.id || 0; 

let miningInterval;
let userAdsWatched = 0;   
let userLinksCompleted = 0; 
let dailySpins = 0;         
const MAX_DAILY_SPINS = 5;  
let currentXu = 0;       
let miningSpeed = 0;     
let fractionalXu = 0;    
let currentTasksState = {}; 
let isSyncing = false;
let extraSpins = 0;
let totalLinksCompleted = 0;
let currentLevel = 1;
let buffInterval;

function showToast(message, type = 'success') {
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

function checkLevelUp(exp, exp_required, level) {
    const btnUpgrade = document.getElementById("btn-upgrade-level");
    const costAlert = document.getElementById("upgrade-cost-alert");
    if (!btnUpgrade || !costAlert) return;

    if (level >= 20) { 
        btnUpgrade.style.display = "none";
        costAlert.style.display = "none";
        return;
    }

    if (exp >= exp_required) {
        let xuNeeded = level * 15000;
        costAlert.innerText = `💡 Điều kiện mở khóa hoàn tất! Phí lên Cấp ${level + 1}: 💰 ${xuNeeded.toLocaleString()} Xu.`;
        costAlert.style.display = "block";
        btnUpgrade.style.display = "block";
        document.getElementById("next-level-display").innerText = level + 1;
    } else {
        btnUpgrade.style.display = "none";
        costAlert.style.display = "none";
    }
}

// ================= HÀM KẾT NỐI API LẤY DATA THẬT =================
async function loadRealData() {
    if (!userId) {
        showToast("Không lấy được ID Telegram từ WebApp!");
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}?initData=${encodeURIComponent(tg.initData)}&t=${new Date().getTime()}`, {
            headers: {
                "ngrok-skip-browser-warning": "true"
            }
        });
        const data = await response.json();
        
        if (data.error) {
            console.error("Lỗi API:", data.error);
            return;
        }

        currentLevel = data.user.level;
        currentXu = data.user.xu;
        miningSpeed = data.user.speed;
        fractionalXu = 0;
        totalLinksCompleted = data.user.total_links || 0;
        extraSpins = data.user.extra_spins || 0;
        let freeTickets = data.user.free_tickets || 0;
        dailySpins = data.user.daily_spins || 0;
        let adCount = data.user.ad_count || 0;
        userAdsWatched = adCount; 

        if(document.getElementById("display-ads-watched")) document.getElementById("display-ads-watched").innerText = userAdsWatched;
        if(document.getElementById("display-extra-spins")) document.getElementById("display-extra-spins").innerText = extraSpins;
        if(document.getElementById("display-free-tickets")) document.getElementById("display-free-tickets").innerText = freeTickets;
        if(document.getElementById("display-daily-spins")) document.getElementById("display-daily-spins").innerText = `${dailySpins}/5`;
        if(document.getElementById("display-ads-count")) document.getElementById("display-ads-count").innerText = adCount % 3;

        document.getElementById("inv-b1h").innerText = data.user.b1h;
        document.getElementById("inv-b2h").innerText = data.user.b2h;
        document.getElementById("inv-b4h").innerText = data.user.b4h;
        document.getElementById("inv-insurance").innerText = data.user.insurance;
        document.getElementById("user-name").innerText = data.user.username ? data.user.username : "Ẩn danh";
        document.getElementById("user-level").innerText = `Lv ${data.user.level}`;
        document.getElementById("user-exp").innerText = data.user.level >= 20 ? "MAX LEVEL" : `${data.user.exp}/${data.user.exp_required}`;
        document.getElementById("xu-balance").innerText = data.user.xu.toLocaleString();
        document.getElementById("vnd-balance").innerText = (data.user.xu / 100).toLocaleString();
        if (data.user.buff_active) {
            miningSpeed = data.user.speed * 2;
            document.getElementById("mining-speed").innerHTML = `<span style="color: #facc15;">${miningSpeed.toLocaleString()} Xu/giờ (Đang x2)</span>`;
        } else {
            miningSpeed = data.user.speed;
            document.getElementById("mining-speed").innerText = `${miningSpeed.toLocaleString()} Xu/giờ`;
        }
        
        startBuffTimer(data.user.buff_expire_at);
        
        

        checkLevelUp(data.user.exp, data.user.exp_required, data.user.level);

        const completedLinksCount = data.tasks.filter(t => t.completed).length;
        const displayLinksEl = document.getElementById("display-links");
        if (displayLinksEl) displayLinksEl.innerText = completedLinksCount;
        userLinksCompleted = completedLinksCount; 

        startMiningTimer(data.user.mining_end_time);

        renderItemButtons(data.user);
        renderLeaderboard(data.leaderboard);
        const rankInfo = document.getElementById("my-rank-info");
        if (rankInfo) {
            rankInfo.innerHTML = `Thứ hạng của bạn: <span style="color: #fff; font-size: 16px;">#${data.user.user_rank}</span> (💰 ${data.user.xu.toLocaleString()} Xu)`;
        }

        data.tasks.forEach(t => {
            currentTasksState[t.id] = t.completed;
        });
        renderTaskList(data.tasks);

        if (data.attendance_status) {
            hasAttendedToday = data.has_attended_today;
            const btnDoAttendance = document.getElementById("btn-do-attendance");
            if (hasAttendedToday && btnDoAttendance) {
                btnDoAttendance.innerHTML = "<i class='fa-solid fa-check'></i> ĐÃ ĐIỂM DANH";
                btnDoAttendance.style.opacity = "0.7";
                btnDoAttendance.disabled = true; 
            }
            let attendedCount = 0;
            const daysMap = [1, 2, 3, 4, 5, 6, 0]; 
            
            data.attendance_status.forEach((isAttended, index) => {
                if (isAttended) {
                    attendedCount++;
                    const dayLi = document.querySelector(`#attendance-list li[data-day="${daysMap[index]}"]`);
                    if (dayLi) {
                        const statusIcon = dayLi.querySelector(".status-icon");
                        if (statusIcon) statusIcon.innerHTML = "<i class='fa-solid fa-circle-check' style='color: var(--color-mint); margin-left: 8px; font-size: 16px;'></i>";
                        dayLi.style.background = "rgba(52, 211, 153, 0.1)";
                        dayLi.style.borderRadius = "8px";
                        dayLi.style.padding = "8px";
                        dayLi.style.borderBottom = "none";
                    }
                }
            });
            
            const progressEl = document.getElementById("attendance-progress");
            if (progressEl) progressEl.innerText = `${data.streak}/7`;

            const btnWeekly = document.getElementById("btn-claim-weekly");
            if (btnWeekly) {
                if (data.weekly_claimed) {
                    btnWeekly.innerHTML = "<i class='fa-solid fa-check-double'></i> ĐÃ NHẬN THƯỞNG";
                    btnWeekly.className = "btn-gray";
                    btnWeekly.disabled = true;
                } else if (data.streak >= 7) {
                    btnWeekly.innerHTML = "<i class='fa-solid fa-unlock fa-bounce'></i> NHẬN RƯƠNG THƯỞNG";
                    btnWeekly.className = "btn-mint";
                    btnWeekly.disabled = false; 
                } else {
                    btnWeekly.innerHTML = "<i class='fa-solid fa-lock'></i> CHƯA ĐỦ ĐIỀU KIỆN";
                    btnWeekly.className = "btn-gray";
                    btnWeekly.disabled = true;
                }
            }
        }
        
    } catch (err) {
        console.error("Lỗi khi kết nối API Server:", err);
    }
}

function startMiningTimer(endTimeStr) {
    const timeElement = document.getElementById("mining-time");
    const btnActivate = document.getElementById("btn-activate-mining");

    if (!endTimeStr || endTimeStr === "None") {
        timeElement.innerText = "00:00:00 (Đang dừng)";
        timeElement.classList.add("time-stopped");
        if (btnActivate) {
            btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO";
            btnActivate.disabled = false;
            btnActivate.style.opacity = "1";
            btnActivate.classList.remove("btn-gray");
        }
        return;
    }
    
    const safeDateStr = endTimeStr.replace(" ", "T") + "+07:00";
    const endTime = new Date(safeDateStr).getTime();
    let distance = endTime - new Date().getTime();
    
    clearInterval(miningInterval);
    miningInterval = setInterval(() => {
        distance -= 1000;
        
        if (distance <= 0) {
            clearInterval(miningInterval);
            timeElement.innerText = "00:00:00 (Đang dừng)";
            timeElement.classList.add("time-stopped");
            
            if (btnActivate) {
                btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO FREE (4H)";
                btnActivate.disabled = false;
                btnActivate.style.opacity = "1";
            }
            return;
        }
        
        if (btnActivate) {
            btnActivate.innerHTML = "<i class='fa-solid fa-hammer fa-bounce'></i> ĐANG ĐÀO...";
            btnActivate.disabled = true;
            btnActivate.style.opacity = "0.7";
            btnActivate.style.background = "#475569"; 
        }

        timeElement.classList.remove("time-stopped");
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        timeElement.innerText = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
        
        if (miningSpeed > 0) {
            fractionalXu += miningSpeed / 3600; 
            if (fractionalXu >= 1) {
                const addXu = Math.floor(fractionalXu);
                currentXu += addXu;
                fractionalXu -= addXu; 
                
                document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString(); 
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

const AdController = window.Adsgram.init({ blockId: "36819" });
const watchAdBtn = document.getElementById("btn-watch-ad");

function startAdCooldown(btn, seconds = 20, defaultText = "") {
    let timeLeft = seconds;
    btn.disabled = true;
    
    const originalBg = btn.style.background;
    btn.style.background = "#475569"; 
    btn.innerHTML = `<i class='fa-solid fa-clock'></i> CHỜ ${timeLeft}S...`;

    const cooldownTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(cooldownTimer);
            btn.disabled = false;
            btn.innerHTML = defaultText; 
            btn.style.background = originalBg; 
        } else {
            btn.innerHTML = `<i class='fa-solid fa-clock'></i> CHỜ ${timeLeft}S...`;
        }
    }, 1000);
}

if (watchAdBtn) {
    watchAdBtn.addEventListener("click", () => {
        if (userAdsWatched >= 30) {
            return showToast("⚠️ Bạn đã đạt giới hạn 30/30 lượt xem hôm nay!", "error");
        }

        watchAdBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        watchAdBtn.disabled = true;

        AdController.show().then(async (result) => {
            watchAdBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG NHẬN THƯỞNG...";

            try {
                const adUrl = `${BASE_URL}/api/watch_ad`; 
                const res = await fetch(adUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ initData: tg.initData }) 
                });
                const data = await res.json();

                if (data.error) {
                    showToast("❌ " + data.error, "error");
                } else if (data.success) {
                    currentXu = data.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();

                    const levelText = document.getElementById("user-level").innerText;
                    if (!levelText.includes("20") && !levelText.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${data.new_exp}/${data.exp_required}`;
                    }
                    
                    let adCount = data.ad_count || 0;
                    userAdsWatched = adCount; 
                    if(document.getElementById("display-ads-watched")) document.getElementById("display-ads-watched").innerText = userAdsWatched;
                    
                    let freeTickets = data.free_tickets || 0;
                    if(document.getElementById("display-ads-count")) document.getElementById("display-ads-count").innerText = adCount % 3;
                    if(document.getElementById("display-free-tickets")) document.getElementById("display-free-tickets").innerText = freeTickets;

                    showToast(`🎉 Bạn vừa nhận đc ${data.reward_xu} Xu và ${data.reward_exp} EXP.`);
                }
            } catch (err) {
                console.error("Lỗi API Ads:", err);
                showToast("❌ Có lỗi mạng khi cộng thưởng, bạn kiểm tra lại đường truyền nhé!");
            }

            const btnText = `<i class='fa-solid fa-tv'></i> XEM QUẢNG CÁO (<span id="display-ads-watched">${userAdsWatched}</span>/30)`;
            startAdCooldown(watchAdBtn, 20, btnText);

        }).catch((error) => {
            const btnText = `<i class='fa-solid fa-tv'></i> XEM QUẢNG CÁO (<span id="display-ads-watched">${userAdsWatched}</span>/30)`;
            const errString = (JSON.stringify(error) + String(error)).toLowerCase();

            if (errString.includes('no ad') || errString.includes('not filled') || errString.includes('unavailable') || errString.includes('load_error')) {
                showToast("⚠️ Hiện tại kho quảng cáo đang tạm hết. Bạn đợi 1 lúc rồi thử lại nhé!", "error");
                startAdCooldown(watchAdBtn, 20, btnText); 
            } else {
                showToast("❌ Bạn tắt quảng cáo sớm nên chưa được nhận thưởng đâu nha!", "error");
                startAdCooldown(watchAdBtn, 20, btnText); 
            }
        });
    });
}

const btnActivate = document.getElementById("btn-activate-mining");
if (btnActivate) {
    btnActivate.addEventListener("click", () => {
        if (!userId) {
            return showToast("Không tìm thấy ID User Telegram!");
        }

        btnActivate.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        btnActivate.disabled = true;

        AdController.show().then(async (result) => {
            btnActivate.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG KHỞI ĐỘNG MÁY...";
            
            try {
                const upgUrl = `${BASE_URL}/api/claim_free`;
                const res = await fetch(upgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ initData: tg.initData })
                });
                const data = await res.json();
                
                if (data.error) {
                    showToast(data.error);
                    btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO";
                    btnActivate.disabled = false;
                } else if (data.success) {
                    showToast("🎉 Xem quảng cáo thành công! Máy đào đã chạy.");
                    startMiningTimer(data.new_end_time);
                }
            } catch (err) {
                console.error("Lỗi API Kích hoạt:", err);
                showToast("❌ Lỗi kết nối đến server máy chủ!");
                btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO ";
                btnActivate.disabled = false;
            }

        }).catch((error) => {
            const errString = (JSON.stringify(error) + String(error)).toLowerCase();
            if (errString.includes('no ad') || errString.includes('not filled') || errString.includes('unavailable') || errString.includes('load_error')) {
                showToast("⚠️ Hiện tại kho quảng cáo đang tạm hết. Vui lòng thử nhập mã lại sau 1 lúc nữa!", "error");
                startAdCooldown(btnSubmitGiftcode, 20, "<i class='fa-solid fa-check-circle'></i> KÍCH HOẠT ĐÀO");
            } else {
            showToast("❌ Bạn chưa xem xong quảng cáo hoặc lỗi mạng. Kích hoạt bị hủy!");
            btnActivate.innerHTML = "<i class='fa-solid fa-gift'></i> KÍCH HOẠT ĐÀO";
            btnActivate.disabled = false;
            }
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
    "100 Xu", "3 EXP", "200 Xu", "5 EXP", "300 Xu",
    "7 EXP", "400 Xu", "10 EXP", "500 Xu", "12 EXP"
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
    btnSpin.addEventListener("click", async () => {
        if (isSpinning) return;

        btnSpin.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG KẾT NỐI...";
        btnSpin.style.opacity = "0.7";
        btnSpin.disabled = true; 
        isSpinning = true;

        let isSuccess = false; 

        try {
            const upgUrl = `${BASE_URL}/api/wheel`;
            const res = await fetch(upgUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                body: JSON.stringify({ initData: tg.initData }) 
            });
            const d = await res.json();

            if (d.error) {
                showToast("❌ " + d.error, "error");
                return; 
            }

            if(d.success) {
                isSuccess = true; 

                dailySpins = d.daily_spins;
                extraSpins = d.extra_spins;
                let freeTickets = d.free_tickets;
                
                if(document.getElementById("display-extra-spins")) document.getElementById("display-extra-spins").innerText = extraSpins;
                if(document.getElementById("display-free-tickets")) document.getElementById("display-free-tickets").innerText = freeTickets;
                if(document.getElementById("display-daily-spins")) document.getElementById("display-daily-spins").innerText = `${dailySpins}/5`;

                if(resultDiv) resultDiv.style.opacity = "0";
                
                const prizeIndex = d.prize_index; 
                const spinSpins = 5; 
                const targetDeg = 360 - (prizeIndex * 36 + 18);
                currentRotation += (spinSpins * 360) + targetDeg - (currentRotation % 360);
                
                btnSpin.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG QUAY...";
                wheel.style.transform = `rotate(${currentRotation}deg)`;
                
                setTimeout(() => {
                    isSpinning = false;
                    btnSpin.disabled = false; 
                    btnSpin.innerHTML = "<i class='fa-solid fa-rotate-right'></i> QUAY";
                    btnSpin.style.opacity = "1";
                    
                    if(resultDiv) {
                        resultDiv.innerHTML = `🎉 Chúc mừng trúng: <span style="color: var(--color-gold); font-size: 16px;">${prizes[prizeIndex]}</span>!`;
                        resultDiv.style.opacity = "1";
                    }
                    
                    currentXu = d.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                    
                    const lvl = document.getElementById("user-level").innerText;
                    if(!lvl.includes("20") && !lvl.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${d.new_exp}/${d.exp_required}`;
                    }
                }, 4000);
            }
        } catch(e) { 
            showToast("❌ Mất kết nối đến server, không thể quay!", "error");
        } finally {
            if (!isSuccess) {
                isSpinning = false;
                btnSpin.disabled = false;
                btnSpin.innerHTML = "<i class='fa-solid fa-rotate-right'></i> QUAY";
                btnSpin.style.opacity = "1";
            }
        }
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
        let displayName = user.name;

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
    btnLeaderboard.addEventListener("click", () => {
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
    btnInvite.addEventListener("click", () => {
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
       const shareText = "🔥 Vào cày Xu đào coin Mini App cực bốc cùng mình nhận ngay 5,000 Xu, 20 EXP và 3 lượt quay miễn phí nhé!";
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
            showToast("Hôm nay bạn đã điểm danh rồi! Hãy quay lại vào ngày mai nhé.");
            return;
        }

        btnDoAttendance.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        btnDoAttendance.disabled = true;

        AdController.show().then(async (result) => {
            btnDoAttendance.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG ĐIỂM DANH...";
            
            try {
                const upgUrl = `${BASE_URL}/api/attendance`;
                const res = await fetch(upgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ initData: tg.initData })
                });
                const d = await res.json();
                
                if(d.success) {
                    hasAttendedToday = true;
                    btnDoAttendance.innerHTML = "<i class='fa-solid fa-check'></i> ĐÃ ĐIỂM DANH";
                    btnDoAttendance.style.opacity = "0.7";

                    const todayDay = new Date().getDay(); 
                    const currentDayLi = document.querySelector(`#attendance-list li[data-day="${todayDay}"]`);
                    if (currentDayLi) {
                        const statusIcon = currentDayLi.querySelector(".status-icon");
                        if (statusIcon) statusIcon.innerHTML = "<i class='fa-solid fa-circle-check' style='color: var(--color-mint); margin-left: 8px; font-size: 16px;'></i>";
                        currentDayLi.style.background = "rgba(52, 211, 153, 0.1)";
                        currentDayLi.style.borderRadius = "8px";
                        currentDayLi.style.padding = "8px";
                        currentDayLi.style.borderBottom = "none";
                    }

                    const progressEl = document.getElementById("attendance-progress");
                    if (progressEl) progressEl.innerText = `${d.streak}/7`;

                    currentXu = d.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                    
                    const lvl = document.getElementById("user-level").innerText;
                    if(!lvl.includes("20") && !lvl.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${d.new_exp}/${d.exp_required}`;
                    }

                    if (d.is_weekly) {
                        showToast(`🎉 ĐỈNH CHÓP! Điểm danh đủ 7 ngày. Húp trọn ${d.reward_xu.toLocaleString()} Xu & ${d.reward_exp} EXP!`);
                    } else {
                        showToast(`🎉 Điểm danh thành công! Bạn nhận được ${d.reward_xu} Xu & ${d.reward_exp} EXP.`);
                    }
                } else if (d.error) {
                    showToast("❌ " + d.error);
                    btnDoAttendance.innerHTML = "<i class='fa-solid fa-pen-to-square'></i> ĐIỂM DANH NGAY";
                    btnDoAttendance.disabled = false;
                }
            } catch(e) { 
                console.error("Lỗi API Điểm danh:", e); 
                showToast("❌ Lỗi kết nối máy chủ, vui lòng thử lại!");
                btnDoAttendance.innerHTML = "<i class='fa-solid fa-pen-to-square'></i> ĐIỂM DANH NGAY";
                btnDoAttendance.disabled = false;
            }

        }).catch((error) => {
            const errString = (JSON.stringify(error) + String(error)).toLowerCase();
            if (errString.includes('no ad') || errString.includes('not filled') || errString.includes('unavailable') || errString.includes('load_error')) {
                showToast("⚠️ Hiện tại kho quảng cáo đang tạm hết. Vui lòng thử nhập mã lại sau 1 lúc nữa!", "error");
                startAdCooldown(btnSubmitGiftcode, 20, "<i class='fa-solid fa-check-circle'></i> ĐIỂM DANH NGAY");
            } else {
            showToast("❌ Bạn chưa xem hết quảng cáo nên không thể điểm danh nhé!");
            btnDoAttendance.innerHTML = "<i class='fa-solid fa-pen-to-square'></i> ĐIỂM DANH NGAY";
            btnDoAttendance.disabled = false;
            }
        });
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
                <div class="simple-task-text">Link ${index + 1}: <span onclick="startTaskAndOpen(${task.id}, '${task.link}')" style="color: var(--color-blue); text-decoration: underline; cursor: pointer;">Nhấn để vượt link</span></div>
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
            if (wdFormBank) wdFormBank.style.display = "none";
            if (wdFormMomo) wdFormMomo.style.display = "none";
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
 
        if (document.getElementById("wd-bank-xu")) {
            document.getElementById("wd-bank-xu").innerText = currentXu.toLocaleString();
            document.getElementById("wd-bank-vnd").innerText = (currentXu / 100).toLocaleString();
        }
    });

    btnWdMomo.addEventListener("click", () => {
        wdMethodContainer.style.display = "none";
        wdFormMomo.style.display = "block";

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
            return showToast("Số tiền rút phải từ 2,000 đến 10,000 VNĐ!");
        }
        if (!bankName || !stk || !fullName) {
            return showToast("Vui lòng điền đầy đủ thông tin Ngân hàng!");
        }

        const formatInfo = `${bankName} - ${stk} - ${fullName.toUpperCase()}`;
        const userName = tg.initDataUnsafe?.user?.username || tg.initDataUnsafe?.user?.first_name || "Ẩn danh";
        
        btnSubmitBank.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG XỬ LÝ...";
        btnSubmitBank.disabled = true;

        try {
            const upgUrl = `${BASE_URL}/api/withdraw`;
            const res = await fetch(upgUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                body: JSON.stringify({
                    initData: tg.initData,
                    amount_vnd: amount,
                    method: "Ngân Hàng", 
                    info: formatInfo,
                    username: userName
                })
            });
            const data = await res.json();

            if (data.error) {
                showToast("❌ " + data.error);
            } else if (data.success) {
                currentXu = data.new_xu;
                document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                
                showToast("✅ Lệnh rút đã được gửi! Admin đang xem xét duyệt, bạn chú ý check tin nhắn bot nhé.");
                
                wdFormBank.style.display = "none";
                wdMethodContainer.style.display = "block";
                document.getElementById("bank-amount").value = "";
                document.getElementById("bank-name").value = "";
                document.getElementById("bank-stk").value = "";
                document.getElementById("bank-fullname").value = "";
            }
        } catch (err) {
            showToast("❌ Lỗi kết nối mạng, vui lòng thử lại sau!");
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
            return showToast("Số tiền rút phải từ 2,000 đến 10,000 VNĐ!");
        }
        if (!phone || !fullName) {
            return showToast("Vui lòng điền đầy đủ số điện thoại và tên!");
        }

        const formatInfo = `${phone} - ${fullName.toUpperCase()}`;
        const userName = tg.initDataUnsafe?.user?.username || tg.initDataUnsafe?.user?.first_name || "Ẩn danh";
        
        btnSubmitMomo.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG XỬ LÝ...";
        btnSubmitMomo.disabled = true;

        try {
            const wdUrl = `${BASE_URL}/api/withdraw`;
            const res = await fetch(wdUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                body: JSON.stringify({
                    initData: tg.initData,
                    amount_vnd: amount,
                    method: "Momo",
                    info: formatInfo,
                    username: userName
                })
            });
            const data = await res.json();

            if (data.error) {
                showToast("❌ " + data.error);
            } else if (data.success) {
                currentXu = data.new_xu;
                document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                
                showToast("✅ Lệnh rút đã được gửi! Admin đang xem xét duyệt, bạn chú ý check tin nhắn bot nhé.");
                
                wdFormMomo.style.display = "none";
                wdMethodContainer.style.display = "block";
                document.getElementById("momo-amount").value = "";
                document.getElementById("momo-phone").value = "";
                document.getElementById("momo-fullname").value = "";
            }
        } catch (err) {
            showToast("❌ Lỗi kết nối mạng, vui lòng thử lại sau!");
        }

        btnSubmitMomo.innerHTML = "<i class='fa-solid fa-paper-plane'></i> GỬI LỆNH RÚT";
        btnSubmitMomo.disabled = false;
    });
}

loadRealData();

async function syncData() {
    if (!userId || isSyncing) return;
    isSyncing = true;
    
    try {
        const response = await fetch(`${API_URL}?initData=${encodeURIComponent(tg.initData)}&t=${new Date().getTime()}`, {
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
            totalLinksCompleted = data.user.total_links;
            showToast(`🎉 Bạn vượt thành công ${newlyCompleted} Link. Phần thưởng Xu và EXP đã được cộng vào ví!`);
            
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


const btnUpgrade = document.getElementById("btn-upgrade-level");
if (btnUpgrade) {
    btnUpgrade.addEventListener("click", async () => {
        const requiredLinks = currentLevel * 10;
        if (totalLinksCompleted < requiredLinks) {
            showToast(`⚠️ Chưa thể nâng cấp do chưa đủ số link vượt (Cần ${requiredLinks} link, bạn mới có ${totalLinksCompleted}). Bạn vượt link xong rồi nâng cấp.`, "error");
            return;
        }

        btnUpgrade.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        btnUpgrade.disabled = true;

        AdController.show().then(async (result) => {
            btnUpgrade.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG NÂNG CẤP...";

            try {
                const upgUrl = `${BASE_URL}/api/upgrade`;
                const res = await fetch(upgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ initData: tg.initData })
                });
                const d = await res.json();

                if (d.error) {
                    showToast("❌ " + d.error, "error");
                } else if (d.success) {
                    showToast(`🎉 Bạn vừa thăng cấp lên Lv ${d.new_level}! Tốc độ máy đào đã tăng.`, "success");
                    
                    currentLevel = d.new_level;
                    currentXu = d.new_xu; 
                    document.getElementById("user-level").innerText = `Lv ${d.new_level}`;
                    document.getElementById("user-exp").innerText = d.new_level >= 20 ? "MAX LEVEL" : `${d.new_exp}/${d.new_exp_required}`;
                    document.getElementById("mining-speed").innerText = `${d.new_speed.toLocaleString()} Xu/giờ`;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                    
                    miningSpeed = d.new_speed; 
                    checkLevelUp(d.new_exp, d.new_exp_required, d.new_level);
                }
            } catch (err) {
                showToast("❌ Lỗi kết nối mạng, không thể nâng cấp lúc này!", "error");
            }
            
            if (btnUpgrade.style.display !== "none") {
                const nextLvl = document.getElementById("next-level-display").innerText;
                btnUpgrade.innerHTML = `<i class="fa-solid fa-level-up-alt fa-bounce"></i> NÂNG CẤP LÊN LV <span id="next-level-display">${nextLvl}</span>`;
                btnUpgrade.disabled = false;
            }

        }).catch((error) => {
            const errString = (JSON.stringify(error) + String(error)).toLowerCase();
            if (errString.includes('no ad') || errString.includes('not filled') || errString.includes('unavailable') || errString.includes('load_error')) {
                showToast("⚠️ Hiện tại kho quảng cáo đang tạm hết. Vui lòng thử nhập mã lại sau 1 lúc nữa!", "error");
                startAdCooldown(btnSubmitGiftcode, 20, "<i class='fa-solid fa-check-circle'></i> NÂNG CẤP");
            } else {
            showToast("⚠️ Hiện đang hết video quảng cáo vui lòng thử lại sau.", "error");
            const nextLvl = document.getElementById("next-level-display").innerText;
            btnUpgrade.innerHTML = `<i class="fa-solid fa-level-up-alt fa-bounce"></i> NÂNG CẤP LÊN LV <span id="next-level-display">${nextLvl}</span>`;
            btnUpgrade.disabled = false;
            }
        });
    });
}

// ================= XỬ LÝ NÚT NHẬN THƯỞNG 7 NGÀY =================
const btnClaimWeekly = document.getElementById("btn-claim-weekly");
if (btnClaimWeekly) {
    btnClaimWeekly.addEventListener("click", () => {
        btnClaimWeekly.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        btnClaimWeekly.disabled = true;

        AdController.show().then(async (result) => {
            btnClaimWeekly.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG MỞ RƯƠNG...";

            try {
                const upgUrl = `${BASE_URL}/api/claim_weekly`;
                const res = await fetch(upgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ initData: tg.initData })
                });
                const d = await res.json();
                
                if (d.success) {
                    btnClaimWeekly.innerHTML = "<i class='fa-solid fa-check-double'></i> ĐÃ NHẬN THƯỞNG";
                    btnClaimWeekly.className = "btn-gray";
                    
                    currentXu = d.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();
                    
                    const lvl = document.getElementById("user-level").innerText;
                    if(!lvl.includes("20") && !lvl.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${d.new_exp}/${d.exp_required}`;
                    }
                    
                    showToast(`🎉 CHÚC MỪNG! Mở rương thành công, nhận ${d.reward_xu.toLocaleString()} Xu & ${d.reward_exp} EXP!`);
                } else if (d.error) {
                    showToast("❌ " + d.error);
                    btnClaimWeekly.innerHTML = "<i class='fa-solid fa-unlock fa-bounce'></i> NHẬN RƯƠNG THƯỞNG";
                    btnClaimWeekly.disabled = false;
                }
            } catch(e) {
                console.error("Lỗi:", e);
                showToast("❌ Lỗi mạng, không thể nhận thưởng!");
                btnClaimWeekly.innerHTML = "<i class='fa-solid fa-unlock fa-bounce'></i> NHẬN RƯƠNG THƯỞNG";
                btnClaimWeekly.disabled = false;
            }
        }).catch((error) => {
            const errString = (JSON.stringify(error) + String(error)).toLowerCase();
            if (errString.includes('no ad') || errString.includes('not filled') || errString.includes('unavailable') || errString.includes('load_error')) {
                showToast("⚠️ Hiện tại kho quảng cáo đang tạm hết. Vui lòng thử nhập mã lại sau 1 lúc nữa!", "error");
                startAdCooldown(btnSubmitGiftcode, 20, "<i class='fa-solid fa-check-circle'></i> NHẬN THƯỞNG");
            } else {
            showToast("❌ Bạn chưa xem hết quảng cáo nên rương bị khóa lại nhé!");
            btnClaimWeekly.innerHTML = "<i class='fa-solid fa-unlock fa-bounce'></i> NHẬN RƯƠNG THƯỞNG";
            btnClaimWeekly.disabled = false;
            }
        });
    });
}

// ================= LOGIC GIFT CODE =================
const btnGiftcode = document.getElementById("btn-giftcode");
const inlineGiftcodeContainer = document.getElementById("inline-giftcode-container");
const btnBackGiftcode = document.getElementById("btn-back-giftcode");
const btnSubmitGiftcode = document.getElementById("btn-submit-giftcode");
const inputGiftcode = document.getElementById("input-giftcode");

if (btnGiftcode) {
    btnGiftcode.addEventListener("click", () => {
        utilsButtonsContainer.style.display = "none";
        inlineGiftcodeContainer.style.display = "block";
    });
}

if (btnBackGiftcode) {
    btnBackGiftcode.addEventListener("click", () => {
        inlineGiftcodeContainer.style.display = "none";
        utilsButtonsContainer.style.display = "block";
        inputGiftcode.value = ""; 
    });
}

if (btnSubmitGiftcode) {
    btnSubmitGiftcode.addEventListener("click", async () => {
        const code = inputGiftcode.value.trim().toUpperCase(); 
        
        if (!code) {
            return showToast("⚠️ Bạn chưa nhập mã Gift Code!", "error");
        }

        btnSubmitGiftcode.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG TẢI QUẢNG CÁO...";
        btnSubmitGiftcode.disabled = true;

        AdController.show().then(async (result) => {
            btnSubmitGiftcode.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> ĐANG KIỂM TRA MÃ...";

            try {
                const res = await fetch(`${BASE_URL}/api/giftcode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
                    body: JSON.stringify({ initData: tg.initData, code: code })
                });
                const d = await res.json();

                btnSubmitGiftcode.innerHTML = "<i class='fa-solid fa-check-circle'></i> XÁC NHẬN MÃ";
                btnSubmitGiftcode.disabled = false;

                if (d.error) {
                    showToast("❌ " + d.error, "error");
                } else if (d.success) {
                    // Tiền về ví nhảy số
                    currentXu = d.new_xu;
                    document.getElementById("xu-balance").innerText = currentXu.toLocaleString();
                    document.getElementById("vnd-balance").innerText = (currentXu / 100).toLocaleString();

                    const lvl = document.getElementById("user-level").innerText;
                    if(!lvl.includes("20") && !lvl.includes("MAX")) {
                        document.getElementById("user-exp").innerText = `${d.new_exp}/${d.exp_required}`;
                    }
                    let rewardMsg = "";
                    if (d.reward_xu > 0 && d.reward_exp > 0) {
                        rewardMsg = `${d.reward_xu.toLocaleString()} Xu & ${d.reward_exp} EXP`;
                    } else if (d.reward_xu > 0) {
                        rewardMsg = `${d.reward_xu.toLocaleString()} Xu`;
                    } else if (d.reward_exp > 0) {
                        rewardMsg = `${d.reward_exp} EXP`;
                    }

                    showToast(`🎉 Nhập mã thành công! Bạn nhận đc ${rewardMsg}.`, "success");
                    inputGiftcode.value = ""; 
                }
            } catch (err) {
                btnSubmitGiftcode.innerHTML = "<i class='fa-solid fa-check-circle'></i> XÁC NHẬN MÃ";
                btnSubmitGiftcode.disabled = false;
                showToast("❌ Mất kết nối đến server, vui lòng thử lại!", "error");
            }

        }).catch((error) => {
            const errString = (JSON.stringify(error) + String(error)).toLowerCase();
            if (errString.includes('no ad') || errString.includes('not filled') || errString.includes('unavailable') || errString.includes('load_error')) {
                showToast("⚠️ Hiện tại kho quảng cáo đang tạm hết. Vui lòng thử nhập mã lại sau 1 lúc nữa!", "error");
                startAdCooldown(btnSubmitGiftcode, 20, "<i class='fa-solid fa-check-circle'></i> XÁC NHẬN MÃ");
            } else {
            showToast("❌ Bạn chưa xem hết quảng cáo nên mã bị hủy rồi nhé!", "error");
            btnSubmitGiftcode.innerHTML = "<i class='fa-solid fa-check-circle'></i> XÁC NHẬN MÃ";
            btnSubmitGiftcode.disabled = false;
            }
        });
    });
}

function renderItemButtons(user) {
    const prices = { "b1h": "20K Xu", "b2h": "30K Xu", "b4h": "50K Xu", "insurance": "10K Xu" };
    
    console.log("User data:", user); 

    document.querySelectorAll(".btn-item-action").forEach(btn => {
        const itemType = btn.getAttribute("data-item");
        const count = user[itemType];
        
        console.log(`Item: ${itemType}, Count: ${count}, Price: ${prices[itemType]}`);
        
        if (count > 0) {
            btn.innerHTML = "<i class='fa-solid fa-play'></i> Sử dụng";
            btn.className = "btn-item-action btn-mint";
            btn.onclick = () => useItem(itemType);
        } else {
            const priceText = prices[itemType] || "N/A";
            btn.innerHTML = `<i class='fa-solid fa-cart-shopping'></i> Mua ${priceText}`;
            btn.className = "btn-item-action btn-primary";
            btn.onclick = () => buyItem(itemType);
        }
    });
}

async function buyItem(itemType) {
    try {
        const res = await fetch(`${BASE_URL}/api/buy_item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ initData: tg.initData, item_type: itemType })
        });
        const d = await res.json();
        if(d.error) return showToast("❌ " + d.error, "error");
        if(d.success) {
            showToast("🎉 Mua thành công! Đã thêm vào túi đồ.");
            loadRealData(); 
        }
    } catch(e) { showToast("Lỗi kết nối mua đồ", "error"); }
}

async function useItem(itemType) {
    try {
        const res = await fetch(`${BASE_URL}/api/use_item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ initData: tg.initData, item_type: itemType })
        });
        const d = await res.json();
        if(d.error) return showToast("❌ " + d.error, "error");
        if(d.success) {
            showToast("🚀 " + d.msg, "success");
            loadRealData();
        }
    } catch(e) { showToast("Lỗi kết nối sử dụng đồ", "error"); }
}

const btnOpenInv = document.getElementById("btn-open-inventory");
const btnBackInv = document.getElementById("btn-back-inventory");
const inlineInvContainer = document.getElementById("inline-inventory-container");

if(btnOpenInv) {
    btnOpenInv.addEventListener("click", () => {
        document.getElementById("utils-buttons-container").style.display = "none";
        inlineInvContainer.style.display = "block";
    });
}
if(btnBackInv) {
    btnBackInv.addEventListener("click", () => {
        inlineInvContainer.style.display = "none";
        document.getElementById("utils-buttons-container").style.display = "block";
    });
}

function startBuffTimer(endTimeStr) {
    const buffElement = document.getElementById("buff-time");
    clearInterval(buffInterval);

    if (!endTimeStr || endTimeStr === "None") {
        buffElement.innerHTML = `<span style="color: var(--text-muted); font-weight: normal;">Chưa kích hoạt</span>`;
        return;
    }
    
    const safeDateStr = endTimeStr.replace(" ", "T") + "+07:00";
    const endTime = new Date(safeDateStr).getTime();
    
    buffInterval = setInterval(() => {
        let distance = endTime - new Date().getTime();
        
        if (distance <= 0) {
            clearInterval(buffInterval);
            buffElement.innerHTML = `<span style="color: var(--text-muted); font-weight: normal;">Đã hết hạn</span>`;
            setTimeout(loadRealData, 1500); 
            return;
        }
        
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        buffElement.innerHTML = `<span style="color: #facc15; font-weight: bold;">Đang x2 (${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')})</span>`;
    }, 1000);
}

async function startTaskAndOpen(taskId, url) {
    try {
        await fetch(`${BASE_URL}/api/start_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ initData: tg.initData, task_id: taskId })
        });
        window.open(url, "_blank");
    } catch(e) {}
}