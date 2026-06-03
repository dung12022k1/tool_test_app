import os
import re
import sys
import json
import time
import subprocess
import tempfile
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

app = Flask(__name__, static_folder='.')
CORS(app)

ADB_PATH = "/home/adminpc/Android/Sdk/platform-tools/adb" if os.path.exists("/home/adminpc/Android/Sdk/platform-tools/adb") else "adb"
AAPT_PATH = "/home/adminpc/Android/Sdk/build-tools/37.0.0/aapt" if os.path.exists("/home/adminpc/Android/Sdk/build-tools/37.0.0/aapt") else "aapt"


# Memory log buffer for Server-Sent Events (SSE)
execution_logs = []
is_running = False

def log_message(msg, level="info"):
    timestamp = time.strftime("%H:%M:%S")
    log_entry = {"time": timestamp, "message": msg, "level": level}
    execution_logs.append(log_entry)
    print(f"[{level.upper()}] {msg}")

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

# ----------------- ADB & DEVICE ENDPOINTS -----------------

@app.route('/api/devices', methods=['GET'])
def get_devices():
    try:
        result = subprocess.run([ADB_PATH, "devices"], capture_output=True, text=True, check=True)
        lines = result.stdout.strip().split('\n')[1:]
        devices = []
        for line in lines:
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 2:
                device_id = parts[0]
                status = parts[1]
                
                # Get device model name
                model = "Unknown Device"
                try:
                    model_res = subprocess.run([ADB_PATH, "-s", device_id, "shell", "getprop", "ro.product.model"], capture_output=True, text=True, timeout=2)
                    model = model_res.stdout.strip()
                except Exception:
                    pass
                
                # Get IP if connected via wifi
                ip = ""
                if "." in device_id and ":" in device_id:
                    ip = device_id.split(":")[0]
                else:
                    try:
                        ip_res = subprocess.run([ADB_PATH, "-s", device_id, "shell", "ip", "route"], capture_output=True, text=True, timeout=2)
                        match = re.search(r'src\s+([0-9.]+)', ip_res.stdout)
                        if match:
                            ip = match.group(1)
                    except Exception:
                        pass
                
                devices.append({
                    "id": device_id,
                    "model": model,
                    "status": status,
                    "ip": ip
                })
        return jsonify(devices)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/device-screen/<device_id>', methods=['GET'])
def get_device_screen(device_id):
    try:
        # Capture screen directly as a PNG stream
        result = subprocess.run([ADB_PATH, "-s", device_id, "exec-out", "screencap", "-p"], capture_output=True, timeout=5)
        if result.returncode == 0:
            return Response(result.stdout, mimetype="image/png")
        else:
            return jsonify({"error": "Failed to take screenshot"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ----------------- APK ANALYSIS ENDPOINT -----------------

@app.route('/api/apk-info', methods=['POST'])
def parse_apk():
    if 'apk' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['apk']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    # Save file to a temporary location
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, file.filename)
    file.save(temp_path)
    
    try:
        # Run aapt dump badging to extract package and main activity
        result = subprocess.run([AAPT_PATH, "dump", "badging", temp_path], capture_output=True, text=True, check=True)
        stdout = result.stdout
        
        # Regex to parse package name
        package_match = re.search(r"package: name='([^']+)'", stdout)
        package_name = package_match.group(1) if package_match else "Unknown"
        
        # Regex to parse launcher activity
        activity_match = re.search(r"launchable-activity: name='([^']+)'", stdout)
        main_activity = activity_match.group(1) if activity_match else "Unknown"
        
        # Get label/name
        label_match = re.search(r"application-label:'([^']+)'", stdout)
        if not label_match:
            label_match = re.search(r"application: label='([^']+)'", stdout)
        app_name = label_match.group(1) if label_match else file.filename.replace('.apk', '')
        
        # Get file size
        size_bytes = os.path.getsize(temp_path)
        size_mb = round(size_bytes / (1024 * 1024), 2)
        
        return jsonify({
            "appName": app_name,
            "packageName": package_name,
            "mainActivity": main_activity,
            "sizeMb": size_mb
        })
    except Exception as e:
        return jsonify({"error": f"Failed to parse APK: {str(e)}"}), 500
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

# ----------------- REAL-TIME EXECUTION LOGSTREAM -----------------

@app.route('/api/logs-stream')
def logs_stream():
    def event_stream():
        global execution_logs
        last_index = 0
        while True:
            if last_index < len(execution_logs):
                for i in range(last_index, len(execution_logs)):
                    yield f"data: {json.dumps(execution_logs[i])}\n\n"
                last_index = len(execution_logs)
            time.sleep(0.2)
    return Response(event_stream(), mimetype="text/event-stream")

# ----------------- NATIVE ADB AUTOMATION ENGINE -----------------

def run_adb_step(device_id, step, index):
    action = step.get("action")
    selector = step.get("selector")
    selector_value = step.get("selectorValue", "")
    text_to_input = step.get("textToInput", "")
    duration = int(step.get("duration", "1000"))
    
    log_message(f"[{index + 1}] Executing Step: {action} ({selector or 'N/A'})", "info")
    
    if action == "LAUNCH_APP":
        # Launch app using ADB monkey (highly reliable)
        cmd = [ADB_PATH, "-s", device_id, "shell", "monkey", "-p", selector_value, "-c", "android.intent.category.LAUNCHER", "1"]
        subprocess.run(cmd, capture_output=True)
        log_message(f"Launched application: {selector_value}", "success")
        
    elif action == "CLICK":
        if selector == "COORDINATES":
            # Value format: "X,Y"
            coords = selector_value.split(',')
            if len(coords) == 2:
                cmd = [ADB_PATH, "-s", device_id, "shell", "input", "tap", coords[0].strip(), coords[1].strip()]
                subprocess.run(cmd, capture_output=True)
                log_message(f"Clicked coordinate: ({coords[0].strip()}, {coords[1].strip()})", "success")
            else:
                log_message("Invalid coordinates format. Expected 'X,Y'", "error")
        else:
            # Advanced selector matching via UI hierarchy parsing
            log_message(f"Locating element by {selector}: '{selector_value}'...", "info")
            coords = find_element_coords(device_id, selector, selector_value)
            if coords:
                cmd = [ADB_PATH, "-s", device_id, "shell", "input", "tap", str(coords[0]), str(coords[1])]
                subprocess.run(cmd, capture_output=True)
                log_message(f"Found element and clicked at ({coords[0]}, {coords[1]})", "success")
            else:
                log_message(f"Element not found by {selector}: '{selector_value}'", "error")
                return False
                
    elif action == "INPUT":
        # First locate the field to click/focus it
        if selector and selector_value:
            coords = find_element_coords(device_id, selector, selector_value)
            if coords:
                subprocess.run([ADB_PATH, "-s", device_id, "shell", "input", "tap", str(coords[0]), str(coords[1])], capture_output=True)
                time.sleep(0.5)
        
        # Clear field and type text via ADB input text
        # Replace spaces with %s for ADB compatibility
        escaped_text = text_to_input.replace(" ", "%s")
        cmd = [ADB_PATH, "-s", device_id, "shell", "input", "text", escaped_text]
        subprocess.run(cmd, capture_output=True)
        log_message(f"Inputted text: '{text_to_input}'", "success")
        
    elif action == "WAIT":
        log_message(f"Pausing for {duration}ms...", "info")
        time.sleep(duration / 1000.0)
        
    elif action == "SWIPE":
        # Default swipe up/down if coordinates not specified
        if selector_value == "UP":
            cmd = [ADB_PATH, "-s", device_id, "shell", "input", "swipe", "500", "1500", "500", "500", "500"]
        elif selector_value == "DOWN":
            cmd = [ADB_PATH, "-s", device_id, "shell", "input", "swipe", "500", "500", "500", "1500", "500"]
        else:
            # Custom coordinates swipe: "x1,y1,x2,y2"
            parts = selector_value.split(',')
            if len(parts) == 4:
                cmd = [ADB_PATH, "-s", device_id, "shell", "input", "swipe", parts[0], parts[1], parts[2], parts[3], "500"]
            else:
                cmd = [ADB_PATH, "-s", device_id, "shell", "input", "swipe", "500", "1500", "500", "500", "500"]
        subprocess.run(cmd, capture_output=True)
        log_message(f"Performed swipe action: {selector_value}", "success")
        
    elif action == "BACK":
        cmd = [ADB_PATH, "-s", device_id, "shell", "input", "keyevent", "4"]
        subprocess.run(cmd, capture_output=True)
        log_message("Pressed back button", "success")
        
    elif action == "HOME":
        cmd = [ADB_PATH, "-s", device_id, "shell", "input", "keyevent", "3"]
        subprocess.run(cmd, capture_output=True)
        log_message("Pressed home button", "success")
        
    return True

def find_element_coords(device_id, selector_type, value):
    try:
        # Dump UI XML hierarchy to device and retrieve it
        temp_dir = tempfile.gettempdir()
        xml_path = os.path.join(temp_dir, "window_dump.xml")
        
        # Remove any leftover file
        if os.path.exists(xml_path):
            os.remove(xml_path)
            
        subprocess.run([ADB_PATH, "-s", device_id, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"], capture_output=True, timeout=5)
        subprocess.run([ADB_PATH, "-s", device_id, "pull", "/sdcard/window_dump.xml", xml_path], capture_output=True, timeout=5)
        
        if not os.path.exists(xml_path):
            return None
            
        with open(xml_path, 'r', encoding='utf-8', errors='ignore') as f:
            xml_content = f.read()
            
        # Parse elements manually with regex to avoid heavy xml dependency issues
        # Node format: <node index="0" text="Text" resource-id="id" bounds="[x1,y1][x2,y2]" />
        nodes = re.findall(r'<node\s+[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml_content)
        
        for node in re.finditer(r'<node\s+([^>]+)bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_content):
            attrs = node.group(1)
            x1, y1, x2, y2 = int(node.group(2)), int(node.group(3)), int(node.group(4)), int(node.group(5))
            
            # Extract specific attributes
            node_id_match = re.search(r'resource-id="([^"]*)"', attrs)
            node_text_match = re.search(r'text="([^"]*)"', attrs)
            node_desc_match = re.search(r'content-desc="([^"]*)"', attrs)
            
            node_id = node_id_match.group(1) if node_id_match else ""
            node_text = node_text_match.group(1) if node_text_match else ""
            node_desc = node_desc_match.group(1) if node_desc_match else ""
            
            matched = False
            if selector_type == "ID" and value in node_id:
                matched = True
            elif selector_type == "TEXT" and value.lower() in node_text.lower():
                matched = True
            elif selector_type == "ACCESSIBILITY_ID" and value in node_desc:
                matched = True
            elif selector_type == "XPATH" and value in attrs: # Simple fuzzy xpath match
                matched = True
                
            if matched:
                # Return center coordinates of bounds
                center_x = (x1 + x2) // 2
                center_y = (y1 + y2) // 2
                return (center_x, center_y)
                
        return None
    except Exception as e:
        print(f"Error parsing UI XML: {str(e)}")
        return None

@app.route('/api/run', methods=['POST'])
def start_automation():
    global is_running, execution_logs
    if is_running:
        return jsonify({"error": "Automation is already running"}), 400
        
    data = request.json
    device_id = data.get("deviceId")
    scenario = data.get("scenario")
    
    if not device_id or not scenario:
        return jsonify({"error": "Device ID and Scenario are required"}), 400
        
    is_running = True
    execution_logs.clear()
    
    log_message(f"Starting automation on device {device_id}...", "info")
    log_message(f"Scenario: {scenario.get('name', 'Unnamed Scenario')}", "info")
    
    steps = scenario.get("steps", [])
    
    # Run steps in a separate execution block
    success = True
    for i, step in enumerate(steps):
        if not is_running:
            log_message("Automation execution cancelled by user.", "warning")
            break
        result = run_adb_step(device_id, step, i)
        if not result:
            success = False
            log_message(f"Execution failed at step {i + 1}.", "error")
            break
            
    if success:
        log_message("Automation completed successfully! All steps passed.", "success")
    else:
        log_message("Automation run finished with errors.", "error")
        
    is_running = False
    return jsonify({"status": "completed", "success": success})

@app.route('/api/stop', methods=['POST'])
def stop_automation():
    global is_running
    if not is_running:
        return jsonify({"status": "idle"})
    is_running = False
    log_message("Requesting test runner to stop...", "warning")
    return jsonify({"status": "stopping"})

if __name__ == '__main__':
    log_message("Initializing Reborn VIO Automation Server...", "info")
    log_message(f"Local ADB path configured: {ADB_PATH}", "info")
    log_message(f"Local AAPT path configured: {AAPT_PATH}", "info")
    app.run(host='0.0.0.0', port=5000, debug=False)
