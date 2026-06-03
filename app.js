// VIO Reborn Application State
const state = {
    devices: [],
    activeDeviceId: null,
    activeDeviceModel: "",
    activeDeviceWidth: 1080, // Default fallback
    activeDeviceHeight: 2400, // Default fallback
    apkInfo: null,
    steps: [],
    isRunning: false,
    mirrorEnabled: true,
    mirrorIntervalId: null,
    logSource: null
};

// UI Element Selector Map
const DOM = {
    refreshDevicesBtn: document.getElementById('refresh-devices-btn'),
    devicesList: document.getElementById('devices-list'),
    selectedDevicePanel: document.getElementById('selected-device-panel'),
    activeDeviceModel: document.getElementById('active-device-model'),
    activeDeviceId: document.getElementById('active-device-id'),
    screenMirrorImg: document.getElementById('screen-mirror-img'),
    mirrorSpinner: document.getElementById('mirror-spinner'),
    mirrorStatusText: document.getElementById('mirror-status-text'),
    toggleMirrorBtn: document.getElementById('toggle-mirror-btn'),
    
    // APK Analyzer
    apkDropzone: document.getElementById('apk-dropzone'),
    apkFileInput: document.getElementById('apk-file-input'),
    apkDetailsCard: document.getElementById('apk-details-card'),
    apkLabel: document.getElementById('apk-label'),
    apkSize: document.getElementById('apk-size'),
    apkPackage: document.getElementById('apk-package'),
    apkActivity: document.getElementById('apk-activity'),
    
    // Terminal Log
    runnerStatusPill: document.getElementById('runner-status-pill'),
    clearLogsBtn: document.getElementById('clear-logs-btn'),
    consoleTerminal: document.getElementById('console-terminal'),
    
    // Execution Controls
    engineSelect: document.getElementById('engine-select'),
    startRunBtn: document.getElementById('start-run-btn'),
    stopRunBtn: document.getElementById('stop-run-btn'),
    
    // Scenario Builder
    scenarioNameInput: document.getElementById('scenario-name-input'),
    importBtn: document.getElementById('import-btn'),
    exportBtn: document.getElementById('export-btn'),
    importFileInput: document.getElementById('import-file-input'),
    stepsCounterBadge: document.getElementById('steps-counter-badge'),
    scenarioStepsList: document.getElementById('scenario-steps-list'),
    
    // Add Step Form
    stepAction: document.getElementById('step-action'),
    stepSelector: document.getElementById('step-selector'),
    selectorGroup: document.getElementById('selector-group'),
    valueGroup: document.getElementById('value-group'),
    valueLabel: document.getElementById('value-label'),
    stepValue: document.getElementById('step-value'),
    inputTextGroup: document.getElementById('input-text-group'),
    stepInputText: document.getElementById('step-input-text'),
    durationGroup: document.getElementById('duration-group'),
    stepDuration: document.getElementById('step-duration'),
    addStepBtn: document.getElementById('add-step-btn')
};

// ----------------- INITIALIZATION & DEVICE WORK -----------------

// Fetch connected devices from API
async function scanDevices() {
    DOM.devicesList.innerHTML = '<p class="empty-state">Scanning ADB connections...</p>';
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();
        state.devices = data;
        
        DOM.devicesList.innerHTML = '';
        if (state.devices.length === 0) {
            DOM.devicesList.innerHTML = '<p class="empty-state">No Android devices found. Make sure USB Debugging is active.</p>';
            selectDevice(null);
            return;
        }
        
        state.devices.forEach(device => {
            const card = document.createElement('div');
            card.className = `device-card ${state.activeDeviceId === device.id ? 'active' : ''}`;
            card.innerHTML = `
                <div class="device-info">
                    <span class="device-model">${device.model}</span>
                    <span class="device-ip">${device.id} ${device.ip ? '(' + device.ip + ')' : ''}</span>
                </div>
                <span class="device-status ${device.status}">${device.status}</span>
            `;
            card.addEventListener('click', () => selectDevice(device));
            DOM.devicesList.appendChild(card);
        });

        // Auto select first device if none selected
        if (state.devices.length > 0 && !state.activeDeviceId) {
            selectDevice(state.devices[0]);
        }
    } catch (err) {
        DOM.devicesList.innerHTML = `<p class="empty-state error" style="color:var(--accent-red)">Error scanning: ${err.message}</p>`;
    }
}

// Select active device and initialize mirror stream
function selectDevice(device) {
    if (state.mirrorIntervalId) {
        clearInterval(state.mirrorIntervalId);
        state.mirrorIntervalId = null;
    }

    if (!device) {
        state.activeDeviceId = null;
        state.activeDeviceModel = "";
        DOM.selectedDevicePanel.style.display = 'none';
        DOM.startRunBtn.disabled = true;
        return;
    }
    
    state.activeDeviceId = device.id;
    state.activeDeviceModel = device.model;
    
    DOM.activeDeviceModel.textContent = device.model;
    DOM.activeDeviceId.textContent = device.id;
    DOM.selectedDevicePanel.style.display = 'flex';
    
    // Highlight correct device card
    document.querySelectorAll('.device-card').forEach(card => {
        const text = card.querySelector('.device-ip').textContent;
        if (text.includes(device.id)) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
    
    // Retrieve actual display size to scale coordinates accurately
    queryDisplaySize(device.id);

    // Initialize Mirror Display
    DOM.screenMirrorImg.style.display = 'none';
    DOM.mirrorSpinner.style.display = 'block';
    DOM.mirrorStatusText.style.display = 'none';
    
    state.mirrorEnabled = true;
    DOM.toggleMirrorBtn.textContent = "Pause";
    
    // Start mirroring refresh loop
    refreshScreenMirror();
    state.mirrorIntervalId = setInterval(refreshScreenMirror, 800);
    
    updateExecutionButtons();
}

// Fetch device resolution
async function queryDisplaySize(deviceId) {
    try {
        const response = await fetch(`/api/device-resolution/${deviceId}`);
        const data = await response.json();
        if (data.width && data.height) {
            state.activeDeviceWidth = data.width;
            state.activeDeviceHeight = data.height;
            printConsoleLog(`[DEVICE] Resolution set to: ${data.width}x${data.height}`, "info");
        } else {
            state.activeDeviceWidth = 1080;
            state.activeDeviceHeight = 2400;
        }
    } catch (err) {
        console.error("Failed to query display size:", err);
        state.activeDeviceWidth = 1080;
        state.activeDeviceHeight = 2400;
    }
}

// Refresh mirror img from server
function refreshScreenMirror() {
    if (!state.activeDeviceId || !state.mirrorEnabled) return;
    
    // Append timestamp to avoid browser caching the image request
    const imgUrl = `/api/device-screen/${state.activeDeviceId}?t=${Date.now()}`;
    
    const tempImg = new Image();
    tempImg.onload = () => {
        DOM.screenMirrorImg.src = imgUrl;
        DOM.screenMirrorImg.style.display = 'block';
        DOM.mirrorSpinner.style.display = 'none';
        DOM.mirrorStatusText.style.display = 'none';
    };
    tempImg.onerror = () => {
        // Suppress visual error flicker unless completely disconnected
    };
    tempImg.src = imgUrl;
}

// Handle pause / resume mirroring stream
DOM.toggleMirrorBtn.addEventListener('click', () => {
    state.mirrorEnabled = !state.mirrorEnabled;
    if (state.mirrorEnabled) {
        DOM.toggleMirrorBtn.textContent = "Pause";
        DOM.mirrorSpinner.style.display = 'block';
        refreshScreenMirror();
    } else {
        DOM.toggleMirrorBtn.textContent = "Resume";
        DOM.mirrorSpinner.style.display = 'none';
        DOM.mirrorStatusText.style.display = 'block';
        DOM.mirrorStatusText.textContent = "Mirror stream paused";
        DOM.screenMirrorImg.style.display = 'none';
    }
});

// ----------------- VISUAL RECORD & PLAYBACK -----------------

// Listen to tap events on mirror image to record coordinate steps automatically
DOM.screenMirrorImg.addEventListener('click', async (event) => {
    if (!state.activeDeviceId) return;
    
    const rect = DOM.screenMirrorImg.getBoundingClientRect();
    
    // Clicked coordinates relative to the rendered image box
    const displayedX = event.clientX - rect.left;
    const displayedY = event.clientY - rect.top;
    
    const displayedWidth = rect.width;
    const displayedHeight = rect.height;
    
    // Scale coordinates to fit device native screen bounds
    const scaledX = Math.round((displayedX / displayedWidth) * state.activeDeviceWidth);
    const scaledY = Math.round((displayedY / displayedHeight) * state.activeDeviceHeight);
    
    // Create new step
    const newStep = {
        action: "CLICK",
        selector: "COORDINATES",
        selectorValue: `${scaledX},${scaledY}`,
        textToInput: "",
        duration: "1000"
    };
    
    state.steps.push(newStep);
    renderStepsList();
    
    // Add visual tap log to local terminal console
    printConsoleLog(`[RECORDED] Tap coordinate: (${scaledX}, ${scaledY})`, "warning");

    // Also trigger the physical tap on the device in real-time
    try {
        await fetch(`/api/device-click/${state.activeDeviceId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: scaledX, y: scaledY })
        });
        // Settle briefly and refresh mirror image to show transition
        setTimeout(refreshScreenMirror, 300);
    } catch (err) {
        console.error("Failed to execute real-time tap:", err);
    }
});

// ----------------- APK ANALYSIS DRAG ZONE -----------------

// Prevent defaults on dragover/drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    DOM.apkDropzone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

DOM.apkDropzone.addEventListener('dragover', () => DOM.apkDropzone.classList.add('hover'));
DOM.apkDropzone.addEventListener('dragleave', () => DOM.apkDropzone.classList.remove('hover'));
DOM.apkDropzone.addEventListener('drop', (e) => {
    DOM.apkDropzone.classList.remove('hover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].filename.endsWith('.apk')) {
        uploadApk(files[0]);
    } else {
        alert("Please drop a valid .apk file!");
    }
});

DOM.apkDropzone.addEventListener('click', () => DOM.apkFileInput.click());
DOM.apkFileInput.addEventListener('change', () => {
    if (DOM.apkFileInput.files.length > 0) {
        uploadApk(DOM.apkFileInput.files[0]);
    }
});

// Upload and analyze APK
async function uploadApk(file) {
    DOM.apkDropzone.innerHTML = `<div class="spinner"></div><p style="margin-top:8px">Parsing APK: ${file.name}...</p>`;
    
    const formData = new FormData();
    formData.append('apk', file);
    
    try {
        const response = await fetch('/api/apk-info', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.error) {
            alert(data.error);
            resetApkDropzone();
            return;
        }
        
        state.apkInfo = data;
        
        // Render analyzed details card
        DOM.apkLabel.textContent = data.appName;
        DOM.apkSize.textContent = `${data.sizeMb} MB`;
        DOM.apkPackage.textContent = data.packageName;
        DOM.apkActivity.textContent = data.mainActivity;
        
        DOM.apkDropzone.style.display = 'none';
        DOM.apkDetailsCard.style.display = 'flex';
        
        // Auto-add LAUNCH_APP step as first scenario step
        const launchStep = {
            action: "LAUNCH_APP",
            selector: "",
            selectorValue: data.packageName,
            textToInput: "",
            duration: "2000"
        };
        
        // Insert at beginning of scenario
        state.steps.unshift(launchStep);
        renderStepsList();
        
        printConsoleLog(`[APK ANALYZER] Package detected: ${data.packageName}`, "success");
        
        updateExecutionButtons();
    } catch (err) {
        alert("Failed to analyze APK: " + err.message);
        resetApkDropzone();
    }
}

function resetApkDropzone() {
    state.apkInfo = null;
    DOM.apkDropzone.innerHTML = `
        <div class="upload-icon">📦</div>
        <p>Drag & drop APK file here or <span>browse files</span></p>
    `;
    DOM.apkDropzone.style.display = 'flex';
    DOM.apkDetailsCard.style.display = 'none';
    updateExecutionButtons();
}

// ----------------- AUTOMATION CONTROLS & LOG SSE -----------------

function updateExecutionButtons() {
    const hasSteps = state.steps.length > 0;
    const hasDevice = state.activeDeviceId !== null;
    DOM.startRunBtn.disabled = !hasSteps || !hasDevice || state.isRunning;
    DOM.stopRunBtn.disabled = !state.isRunning;
}

// Stream logs in real-time using SSE
function startLogStream() {
    if (state.logSource) state.logSource.close();
    
    state.logSource = new EventSource('/api/logs-stream');
    state.logSource.onmessage = (event) => {
        const log = JSON.parse(event.data);
        printConsoleLog(log.message, log.level);
    };
    state.logSource.onerror = () => {
        // Graceful handle stream disconnects on stop
    };
}

function stopLogStream() {
    if (state.logSource) {
        state.logSource.close();
        state.logSource = null;
    }
}

function printConsoleLog(msg, level = "info") {
    const line = document.createElement('div');
    line.className = `term-line ${level}`;
    line.textContent = `> ${msg}`;
    
    DOM.consoleTerminal.appendChild(line);
    DOM.consoleTerminal.scrollTop = DOM.consoleTerminal.scrollHeight;
}

DOM.clearLogsBtn.addEventListener('click', () => {
    DOM.consoleTerminal.innerHTML = '<div class="term-line info">> VIO Reborn test runner console ready.</div>';
});

// Run scenario
DOM.startRunBtn.addEventListener('click', async () => {
    if (state.isRunning || !state.activeDeviceId) return;
    
    state.isRunning = true;
    DOM.runnerStatusPill.className = "badge running";
    DOM.runnerStatusPill.textContent = "RUNNING";
    updateExecutionButtons();
    
    // Clear old console logs and start real-time log streaming
    DOM.consoleTerminal.innerHTML = '';
    startLogStream();
    
    const payload = {
        deviceId: state.activeDeviceId,
        scenario: {
            name: DOM.scenarioNameInput.value,
            packageName: state.apkInfo ? state.apkInfo.packageName : "",
            activityName: state.apkInfo ? state.apkInfo.mainActivity : "",
            steps: state.steps
        }
    };
    
    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        // Wait briefly for last logs to stream
        setTimeout(() => {
            state.isRunning = false;
            DOM.runnerStatusPill.className = "badge idle";
            DOM.runnerStatusPill.textContent = "IDLE";
            updateExecutionButtons();
            stopLogStream();
        }, 1000);
        
    } catch (err) {
        printConsoleLog(`Execution failed: ${err.message}`, "error");
        state.isRunning = false;
        DOM.runnerStatusPill.className = "badge idle";
        DOM.runnerStatusPill.textContent = "IDLE";
        updateExecutionButtons();
        stopLogStream();
    }
});

// Stop run
DOM.stopRunBtn.addEventListener('click', async () => {
    DOM.stopRunBtn.disabled = true;
    try {
        await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
        // Suppress stop network errors
    }
});

// ----------------- SCENARIO BUILDER COMPONENT -----------------

// Hide/Show inputs dynamically based on selected action type
DOM.stepAction.addEventListener('change', () => {
    const action = DOM.stepAction.value;
    
    // Defaults
    DOM.selectorGroup.style.display = 'none';
    DOM.valueGroup.style.display = 'none';
    DOM.inputTextGroup.style.display = 'none';
    DOM.durationGroup.style.display = 'none';
    
    if (action === "CLICK") {
        DOM.selectorGroup.style.display = 'flex';
        DOM.valueGroup.style.display = 'flex';
        DOM.valueLabel.textContent = "Target Value (ID, XPath, Coordinates)";
        DOM.stepValue.placeholder = "e.g., btn_login or 500,1000";
    } 
    else if (action === "INPUT") {
        DOM.selectorGroup.style.display = 'flex';
        DOM.valueGroup.style.display = 'flex';
        DOM.inputTextGroup.style.display = 'flex';
        DOM.valueLabel.textContent = "Target Input Field Selector";
        DOM.stepValue.placeholder = "e.g., edt_username";
    }
    else if (action === "WAIT") {
        DOM.durationGroup.style.display = 'flex';
    }
    else if (action === "SWIPE") {
        DOM.valueGroup.style.display = 'flex';
        DOM.valueLabel.textContent = "Swipe Direction or Coords (x1,y1,x2,y2)";
        DOM.stepValue.placeholder = "e.g., UP, DOWN or 500,1500,500,500";
    }
    else if (action === "LAUNCH_APP") {
        DOM.valueGroup.style.display = 'flex';
        DOM.valueLabel.textContent = "Package Name";
        DOM.stepValue.placeholder = "e.g., com.example.app";
    }
});

// Add step button handler
DOM.addStepBtn.addEventListener('click', () => {
    const action = DOM.stepAction.value;
    let step = {
        action: action,
        selector: DOM.selectorGroup.style.display !== 'none' ? DOM.stepSelector.value : "",
        selectorValue: DOM.valueGroup.style.display !== 'none' ? DOM.stepValue.value : "",
        textToInput: DOM.inputTextGroup.style.display !== 'none' ? DOM.stepInputText.value : "",
        duration: DOM.durationGroup.style.display !== 'none' ? DOM.stepDuration.value : "1000"
    };
    
    // Input validation
    if (DOM.valueGroup.style.display !== 'none' && !step.selectorValue) {
        alert("Please enter a Target Value!");
        return;
    }
    
    state.steps.push(step);
    renderStepsList();
    
    // Clear inputs
    DOM.stepValue.value = "";
    DOM.stepInputText.value = "";
});

// Render test steps checklist panel
function renderStepsList() {
    DOM.scenarioStepsList.innerHTML = '';
    DOM.stepsCounterBadge.textContent = `${state.steps.length} steps`;
    
    if (state.steps.length === 0) {
        DOM.scenarioStepsList.innerHTML = '<p class="empty-state">No steps added. Use the form below or click on the mirror to record steps.</p>';
        updateExecutionButtons();
        return;
    }
    
    state.steps.forEach((step, idx) => {
        const stepCard = document.createElement('div');
        stepCard.className = 'step-card';
        
        let detailsText = "";
        if (step.action === "CLICK" || step.action === "INPUT") {
            detailsText = `${step.selector}: '${step.selectorValue}'`;
            if (step.textToInput) detailsText += ` ➔ Type: "${step.textToInput}"`;
        } else if (step.action === "WAIT") {
            detailsText = `${step.duration}ms`;
        } else if (step.action === "SWIPE") {
            detailsText = `${step.selectorValue}`;
        } else if (step.action === "LAUNCH_APP") {
            detailsText = `Package: ${step.selectorValue}`;
        }
        
        stepCard.innerHTML = `
            <div class="step-meta-left">
                <span class="step-number">${String(idx + 1).padStart(2, '0')}</span>
                <div class="step-body">
                    <span class="step-action-name">${step.action}</span>
                    <span class="step-target-details">${detailsText}</span>
                </div>
            </div>
            <div class="step-controls">
                <button class="action-btn-small" onclick="moveStep(${idx}, -1)" title="Move Up">▲</button>
                <button class="action-btn-small" onclick="moveStep(${idx}, 1)" title="Move Down">▼</button>
                <button class="action-btn-small" onclick="deleteStep(${idx})" title="Delete Step" style="color:var(--accent-red)">🗑</button>
            </div>
        `;
        DOM.scenarioStepsList.appendChild(stepCard);
    });
    
    updateExecutionButtons();
}

// Global functions for inline step list actions
window.deleteStep = function(idx) {
    state.steps.splice(idx, 1);
    renderStepsList();
};

window.moveStep = function(idx, direction) {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= state.steps.length) return;
    
    // Swap steps in memory
    const temp = state.steps[idx];
    state.steps[idx] = state.steps[targetIdx];
    state.steps[targetIdx] = temp;
    
    renderStepsList();
};

// ----------------- IMPORT & EXPORT JSON -----------------

DOM.exportBtn.addEventListener('click', () => {
    if (state.steps.length === 0) {
        alert("Add some steps first to export!");
        return;
    }
    
    const payload = {
        name: DOM.scenarioNameInput.value,
        packageName: state.apkInfo ? state.apkInfo.packageName : "",
        activityName: state.apkInfo ? state.apkInfo.mainActivity : "",
        steps: state.steps
    };
    
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.download = `${DOM.scenarioNameInput.value.replace(/\s+/g, '_')}_scenario.json`;
    link.click();
    URL.revokeObjectURL(url);
});

DOM.importBtn.addEventListener('click', () => DOM.importFileInput.click());
DOM.importFileInput.addEventListener('change', () => {
    if (DOM.importFileInput.files.length === 0) return;
    
    const file = DOM.importFileInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.steps || !Array.isArray(data.steps)) {
                alert("Invalid VIO scenario file format. Missing steps array.");
                return;
            }
            
            DOM.scenarioNameInput.value = data.name || "Imported Scenario";
            state.steps = data.steps;
            renderStepsList();
            
            printConsoleLog(`[IMPORT] Successfully imported scenario: ${data.name || "Unnamed"} (${data.steps.length} steps)`, "success");
        } catch (err) {
            alert("Failed to parse JSON file: " + err.message);
        }
    };
    reader.readAsText(file);
});

// Bootstrapping the app
DOM.stepAction.dispatchEvent(new Event('change'));
scanDevices();
setInterval(scanDevices, 8000); // Periodic scanning of adb devices in background
printConsoleLog("Reborn VIO Automation Engine initialized.", "success");
