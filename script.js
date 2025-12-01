/* =======================================================
   ELEMENTS
======================================================= */
const statusIndicator = document.getElementById("statusIndicator");
const inputKp = document.getElementById("kp");
const inputKi = document.getElementById("ki");
const inputKd = document.getElementById("kd");
const inputSetpoint = document.getElementById("setpoint");
const connectBtn = document.getElementById("connectBtn");
const droneObject = document.getElementById("droneObject");
const currentHeight = document.getElementById("currentHeight");
const heightValue = currentHeight.querySelector('.height-value');

let port, reader, writer;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;

/* =======================================================
   UPDATE DRONE POSITION
======================================================= */
function updateDronePosition(height) {
    // Batasi tinggi antara 0-100 cm
    const clampedHeight = Math.max(0, Math.min(100, height));
    
    // Hitung posisi bottom (0% = bawah, 100% = atas)
    // Tinggi maksimum flight-area adalah 400px, kita ingin drone bisa naik sampai 380px dari bottom
    const flightAreaHeight = 380; // 400px - 20px margin bottom
    const bottomPosition = 20 + (clampedHeight / 100) * flightAreaHeight;
    
    // Update posisi drone
    droneObject.style.bottom = bottomPosition + 'px';
    
    // Update teks ketinggian
    heightValue.textContent = clampedHeight.toFixed(1) + ' cm';
    
    // Update warna teks berdasarkan ketinggian
    if (clampedHeight < 20) {
        heightValue.style.color = '#FF2D52';
    } else if (clampedHeight < 60) {
        heightValue.style.color = '#FFC107';
    } else {
        heightValue.style.color = '#00C851';
    }
}

/* =======================================================
   UPDATE STATUS CONNECTED / DISCONNECTED
======================================================= */
function updateStatus(isConnected) {
    if (isConnected) {
        statusIndicator.classList.remove("disconnected");
        statusIndicator.classList.add("connected");
        statusIndicator.innerText = "Terhubung";
        connectBtn.innerText = "Disconnect";
        connectBtn.style.background = "#FF5252";
        enableInputs(true);
    } else {
        statusIndicator.classList.remove("connected");
        statusIndicator.classList.add("disconnected");
        statusIndicator.innerText = "Tidak Terhubung";
        connectBtn.innerText = "Connect ESP32";
        connectBtn.style.background = "#FFC107";
        enableInputs(false);
    }
}

/* =======================================================
   ENABLE/DISABLE INPUTS
======================================================= */
function enableInputs(enabled) {
    inputKp.disabled = !enabled;
    inputKi.disabled = !enabled;
    inputKd.disabled = !enabled;
    inputSetpoint.disabled = !enabled;
    
    // Enable/disable semua tombol
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(btn => {
        btn.disabled = !enabled;
    });
}

/* =======================================================
   WEB SERIAL – CONNECT TO ESP32
======================================================= */
async function connectSerial() {
    // Jika sudah connected, disconnect
    if (isConnected) {
        disconnectSerial();
        return;
    }

    try {
        connectBtn.disabled = true;
        connectBtn.innerText = "Menghubungkan...";
        
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });

        writer = port.writable.getWriter();
        reader = port.readable.getReader();

        isConnected = true;
        reconnectAttempts = 0;
        updateStatus(true);

        readSerialLoop();

    } catch (err) {
        console.log("Gagal terhubung:", err);
        updateStatus(false);
        isConnected = false;
        alert("Gagal terhubung ke ESP32. Pastikan ESP32 terhubung dan port tersedia.");
    } finally {
        connectBtn.disabled = false;
    }
}

/* =======================================================
   DISCONNECT FROM ESP32
======================================================= */
async function disconnectSerial() {
    isConnected = false;
    
    if (reader) {
        try {
            await reader.cancel();
            reader.releaseLock();
        } catch (e) {
            console.log("Error releasing reader:", e);
        }
    }
    
    if (writer) {
        try {
            writer.releaseLock();
        } catch (e) {
            console.log("Error releasing writer:", e);
        }
    }
    
    if (port) {
        try {
            await port.close();
        } catch (e) {
            console.log("Error closing port:", e);
        }
    }
    
    updateStatus(false);
    console.log("Disconnected from ESP32");
}

/* =======================================================
   READ DATA FROM ESP32
======================================================= */
async function readSerialLoop() {
    let buffer = '';
    
    while (port.readable && isConnected) {
        try {
            const { value, done } = await reader.read();
            if (done) {
                console.log("Reader done");
                break;
            }
            
            if (value) {
                const text = new TextDecoder().decode(value);
                buffer += text;
                
                // Process complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Simpan incomplete line
                
                lines.forEach(line => {
                    if (line.trim()) {
                        processIncomingData(line.trim());
                    }
                });
            }
        } catch (err) {
            console.log("Serial error:", err);
            handleDisconnection();
            break;
        }
    }
}

/* =======================================================
   HANDLE DISCONNECTION
======================================================= */
function handleDisconnection() {
    if (isConnected) {
        disconnectSerial();
    }
    
    // Auto-reconnect logic (optional)
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`);
        setTimeout(() => {
            if (!isConnected) {
                connectSerial();
            }
        }, 3000);
    }
}

/* =======================================================
   PROCESS DATA FROM ESP32 (TINGGI CM)
======================================================= */
function processIncomingData(text) {
    // Coba parse sebagai angka (data ketinggian)
    let tinggi = parseFloat(text);
    
    if (!isNaN(tinggi)) {
        addGraphPoint(tinggi);
        updateDronePosition(tinggi); // Update posisi drone
        return;
    }
    
    // Jika bukan angka, tampilkan di console untuk debugging
    console.log("ESP32:", text);
}

/* =======================================================
   SEND DATA TO ESP32
======================================================= */
async function sendToESP32(data) {
    if (!writer || !isConnected) {
        console.log("Not connected to ESP32");
        return false;
    }
    
    try {
        await writer.write(new TextEncoder().encode(data + "\n"));
        console.log("Data sent to ESP32:", data);
        return true;
    } catch (err) {
        console.log("Failed to send data:", err);
        handleDisconnection();
        return false;
    }
}

/* =======================================================
   KIRIM SETPOINT
======================================================= */
function kirimSetpoint() {
    const setpoint = parseFloat(inputSetpoint.value);
    
    if (isNaN(setpoint) || setpoint < 0 || setpoint > 100) {
        alert("Setpoint harus antara 0-100 cm");
        return;
    }
    
    if (sendToESP32("SETPOINT:" + setpoint)) {
        console.log("SETPOINT DIKIRIM:", setpoint);
        // Beri feedback visual
        inputSetpoint.style.borderColor = "#00C851";
        setTimeout(() => {
            inputSetpoint.style.borderColor = "#ccc";
        }, 1000);
    }
}

/* =======================================================
   KIRIM PID
======================================================= */
function kirimPID() {
    const kp = parseFloat(inputKp.value);
    const ki = parseFloat(inputKi.value);
    const kd = parseFloat(inputKd.value);
    
    if (isNaN(kp) || isNaN(ki) || isNaN(kd)) {
        alert("Nilai PID harus angka");
        return;
    }
    
    const packet = `PID:${kp},${ki},${kd}`;
    if (sendToESP32(packet)) {
        console.log("PID DIKIRIM:", packet);
        
        // Beri feedback visual bahwa PID terkirim
        const pidInputs = [inputKp, inputKi, inputKd];
        pidInputs.forEach(input => {
            input.style.borderColor = "#00C851";
        });
        
        setTimeout(() => {
            pidInputs.forEach(input => {
                input.style.borderColor = "#ccc";
            });
        }, 1000);
    }
}

/* =======================================================
   GRAFIK KETINGGIAN (Chart.js)
======================================================= */
let heightChart = null;
let chartData = [];
let chartLabel = [];

function initChart() {
    const ctx = document.createElement("canvas");
    ctx.id = "heightChart";
    const chartBox = document.querySelector(".chart-container");
    chartBox.appendChild(ctx);

    heightChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: chartLabel,
            datasets: [{
                label: "Ketinggian (cm)",
                data: chartData,
                borderWidth: 2,
                borderColor: '#4A63FF',
                backgroundColor: 'rgba(74, 99, 255, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true,
                    max: 100, // Diubah dari 50 menjadi 100
                    title: {
                        display: true,
                        text: 'Ketinggian (cm)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Waktu'
                    }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Grafik Ketinggian Real-time',
                    font: {
                        size: 16
                    }
                }
            }
        }
    });
}

function addGraphPoint(value) {
    // Batasi data yang ditampilkan untuk performa
    if (chartData.length > 50) {
        chartData.shift();
        chartLabel.shift();
    }

    chartData.push(value);
    chartLabel.push(new Date().toLocaleTimeString());

    heightChart.update('none');
}

/* =======================================================
   AUTO INIT (CHART + CONNECT BUTTON)
======================================================= */
window.onload = () => {
    initChart();
    enableInputs(false); // Disable inputs sampai terkoneksi
    updateDronePosition(25); // Set posisi awal drone

    // Shortcut: tekan "C" untuk connect/disconnect
    document.addEventListener("keydown", (e) => {
        if (e.key === "c" || e.key === "C") {
            if (!connectBtn.disabled) {
                connectSerial();
            }
        }
    });
};