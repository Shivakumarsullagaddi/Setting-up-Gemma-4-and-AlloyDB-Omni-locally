import random
import json
import time
import datetime
import uuid
import threading
from collections import deque
import psycopg2
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

machine_state = 'normal'
current_pressure = 280.0
current_temp = 42.0
current_vib = 1.8

THRESHOLDS = {
    "pressure_min": 255.0,
    "pressure_max": 310.0,
    "vibration_max": 4.5,
    "temperature_max": 60.0
}

COOLDOWN_SECONDS = 25.0
last_analysis_time = 0.0
is_analyzing = False
analysis_lock = threading.Lock()

recent_events = deque(maxlen=20)
latest_event = None
last_skipped_info = None

def get_db_connection():
    """Connects to our local, air-gapped AlloyDB Omni instance."""
    try:
        t0 = time.time()
        conn = psycopg2.connect(
            dbname="postgres",
            user="postgres",
            password="omni",
            host="127.0.0.1",
            port="5433"
        )
        latency_ms = round((time.time() - t0) * 1000, 2)
        return conn, latency_ms, None
    except Exception as e:
        return None, None, str(e)

def create_event_record(reasons, trigger_type="threshold_trigger"):
    now_dt = datetime.datetime.now()
    now_time = now_dt.strftime("%H:%M:%S")
    event_id = str(uuid.uuid4())[:8]

    return {
        "id": event_id,
        "timestamp": now_time,
        "created_at_iso": now_dt.isoformat(),
        "trigger_type": trigger_type,
        "stage": "in_progress",
        "machine_state": machine_state,
        "sensor_snapshot": {
            "pressure": round(current_pressure, 2),
            "temperature": round(current_temp, 2),
            "vibration": round(current_vib, 2)
        },
        "threshold_evaluation": {
            "triggered": len(reasons) > 0,
            "reasons": reasons if reasons else ["Nominal baseline check requested"]
        },
        "timeline": [
            {
                "step": "Sensor readings",
                "status": "Success",
                "timestamp": now_time,
                "detail": f"Sampled readings: P={current_pressure:.1f} bar, T={current_temp:.1f} °C, V={current_vib:.2f} mm/s"
            },
            {
                "step": "Threshold detection",
                "status": "Success",
                "timestamp": now_time,
                "detail": "; ".join(reasons) if reasons else "Diagnostic triggered by operator"
            },
            {
                "step": "SQL execution",
                "status": "Pending",
                "timestamp": None,
                "detail": "Dispatching google_ml.predict_row query to AlloyDB Omni"
            },
            {
                "step": "Gemma inference",
                "status": "Pending",
                "timestamp": None,
                "detail": "Awaiting in-database model evaluation via Ollama"
            },
            {
                "step": "AI response",
                "status": "Pending",
                "timestamp": None,
                "detail": "Awaiting LLM response parsing and synthesis"
            }
        ],
        "alloydb": {
            "target": "AlloyDB Omni (127.0.0.1:5433 / postgres)",
            "connection_status": "Pending",
            "connect_duration_ms": None,
            "operation": "SELECT google_ml.predict_row(...)",
            "sql_query": "",
            "model_id": "gemma4:e2b",
            "status": "Pending",
            "duration_ms": None,
            "error": None,
            "architecture_role": "AlloyDB Omni natively executes ML inference in-database via google_ml.predict_row without exposing telemetry over external networks."
        },
        "gemma": {
            "model_id": "gemma4:e2b",
            "provider": "Ollama (Air-gapped local endpoint http://localhost:8080)",
            "prompt": "",
            "request_payload": {
                "model": "gemma4:e2b",
                "prompt": "",
                "stream": False,
                "think": False,
                "options": {
                    "num_ctx": 2048,
                    "num_predict": 128
                }
            },
            "raw_response": None,
            "response_text": None,
            "inference_duration_ms": None,
            "prompt_eval_duration_ms": None,
            "eval_duration_ms": None,
            "prompt_tokens": None,
            "eval_tokens": None,
            "status": "Pending",
            "error": None
        },
        "final_result": {
            "explanation": None,
            "status": "Pending",
            "error": None
        }
    }

def run_ai_analysis_thread(event):
    global is_analyzing, last_analysis_time

    p = event["sensor_snapshot"]["pressure"]
    t = event["sensor_snapshot"]["temperature"]
    v = event["sensor_snapshot"]["vibration"]

    prompt = (
        f"Analyze this sensor data from a 1500T forging press: "
        f"Pressure={p:.1f} bar, Temperature={t:.1f} °C, Vibration={v:.1f} mm/s. "
        f"Normal baseline: Pressure ~280 bar, Temp ~42°C, Vibration ~2.0 mm/s. "
        f"Does this indicate a hydraulic failure or component anomaly? Answer in one short sentence."
    )

    event["gemma"]["prompt"] = prompt
    event["gemma"]["request_payload"]["prompt"] = prompt

    sql_display = (
        "SELECT google_ml.predict_row(\n"
        "    model_id => 'gemma4:e2b',\n"
        "    request_body => json_build_object(\n"
        "        'model', 'gemma4:e2b',\n"
        f"        'prompt', '{prompt}',\n"
        "        'stream', false,\n"
        "        'think', false,\n"
        "        'options', json_build_object(\n"
        "            'num_ctx', 2048,\n"
        "            'num_predict', 128\n"
        "        )\n"
        "    )\n"
        ");"
    )
    event["alloydb"]["sql_query"] = sql_display

    event["timeline"][2]["status"] = "In Progress"
    event["timeline"][2]["timestamp"] = datetime.datetime.now().strftime("%H:%M:%S")

    conn, conn_latency, conn_err = get_db_connection()
    if not conn:
        err_msg = f"Database Connection Error: {conn_err}"
        event["alloydb"]["connection_status"] = "Failed"
        event["alloydb"]["status"] = "Failed"
        event["alloydb"]["error"] = err_msg

        event["timeline"][2]["status"] = "Failed"
        event["timeline"][2]["detail"] = err_msg

        event["timeline"][3]["status"] = "Failed"
        event["timeline"][3]["detail"] = "Aborted due to database connection failure"

        event["timeline"][4]["status"] = "Failed"
        event["timeline"][4]["detail"] = "No AI response available"

        event["gemma"]["status"] = "Failed"
        event["gemma"]["error"] = "Cannot query model: AlloyDB connection failed"

        event["final_result"]["status"] = "Failed"
        event["final_result"]["error"] = err_msg
        event["stage"] = "failed"

        with analysis_lock:
            is_analyzing = False
            last_analysis_time = time.time()
        return

    event["alloydb"]["connection_status"] = "Connected"
    event["alloydb"]["connect_duration_ms"] = conn_latency

    query = """
    SELECT google_ml.predict_row(
        model_id => 'gemma4:e2b',
        request_body => json_build_object(
            'model', 'gemma4:e2b',
            'prompt', %s,
            'stream', false,
            'think', false,
            'options', json_build_object(
                'num_ctx', 2048,
                'num_predict', 128
            )
        )
    );
    """

    try:
        t_sql_start = time.time()
        cur = conn.cursor()

        event["timeline"][3]["status"] = "In Progress"
        event["timeline"][3]["timestamp"] = datetime.datetime.now().strftime("%H:%M:%S")

        cur.execute(query, (prompt,))
        res = cur.fetchone()
        sql_duration_ms = round((time.time() - t_sql_start) * 1000, 2)

        event["alloydb"]["status"] = "Success"
        event["alloydb"]["duration_ms"] = sql_duration_ms
        event["timeline"][2]["status"] = "Success"
        event["timeline"][2]["detail"] = f"Executed via google_ml.predict_row in {sql_duration_ms}ms"

        if res and res[0]:
            parsed = res[0]
            if isinstance(parsed, str):
                try:
                    parsed = json.loads(parsed)
                except Exception:
                    parsed = {"response": parsed}

            event["gemma"]["raw_response"] = parsed

            if isinstance(parsed, dict):
                response_text = parsed.get("response", "")
                event["gemma"]["response_text"] = response_text
                event["gemma"]["status"] = "Success"

                if "total_duration" in parsed:
                    event["gemma"]["inference_duration_ms"] = round(parsed["total_duration"] / 1e6, 2)
                if "prompt_eval_duration" in parsed:
                    event["gemma"]["prompt_eval_duration_ms"] = round(parsed["prompt_eval_duration"] / 1e6, 2)
                if "eval_duration" in parsed:
                    event["gemma"]["eval_duration_ms"] = round(parsed["eval_duration"] / 1e6, 2)
                if "prompt_eval_count" in parsed:
                    event["gemma"]["prompt_tokens"] = parsed["prompt_eval_count"]
                if "eval_count" in parsed:
                    event["gemma"]["eval_tokens"] = parsed["eval_count"]

                tokens_out = event["gemma"].get("eval_tokens")
                dur_ms = event["gemma"].get("eval_duration_ms", sql_duration_ms)
                event["timeline"][3]["status"] = "Success"
                event["timeline"][3]["detail"] = f"Gemma 4 evaluated {tokens_out or 0} tokens in {dur_ms}ms"

                event["timeline"][4]["status"] = "Success"
                event["timeline"][4]["timestamp"] = datetime.datetime.now().strftime("%H:%M:%S")
                event["timeline"][4]["detail"] = "Telemetry synthesized into diagnostic explanation"

                event["final_result"]["status"] = "Success"
                event["final_result"]["explanation"] = response_text
                event["stage"] = "completed"
            else:
                response_text = str(parsed)
                event["gemma"]["response_text"] = response_text
                event["gemma"]["status"] = "Success"
                event["timeline"][3]["status"] = "Success"
                event["timeline"][4]["status"] = "Success"
                event["final_result"]["status"] = "Success"
                event["final_result"]["explanation"] = response_text
                event["stage"] = "completed"
        else:
            err_msg = "AlloyDB returned an empty inference payload."
            event["gemma"]["status"] = "Failed"
            event["gemma"]["error"] = err_msg
            event["timeline"][3]["status"] = "Failed"
            event["timeline"][3]["detail"] = err_msg
            event["timeline"][4]["status"] = "Failed"
            event["final_result"]["status"] = "Failed"
            event["final_result"]["error"] = err_msg
            event["stage"] = "failed"

    except Exception as e:
        err_msg = f"Database AI Execution Error: {str(e)}"
        event["alloydb"]["status"] = "Failed"
        event["alloydb"]["error"] = err_msg
        event["gemma"]["status"] = "Failed"
        event["gemma"]["error"] = err_msg
        event["timeline"][2]["status"] = "Failed"
        event["timeline"][2]["detail"] = err_msg
        event["timeline"][3]["status"] = "Failed"
        event["timeline"][4]["status"] = "Failed"
        event["final_result"]["status"] = "Failed"
        event["final_result"]["error"] = err_msg
        event["stage"] = "failed"
    finally:
        try:
            conn.close()
        except Exception:
            pass
        with analysis_lock:
            is_analyzing = False
            last_analysis_time = time.time()

@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/api/control', methods=['POST'])
def control():
    """Endpoint for the UI to trigger anomalies."""
    global machine_state
    data = request.json or {}
    machine_state = data.get('mode', 'normal')
    return jsonify({"status": "success", "mode": machine_state})

@app.route('/api/reset', methods=['POST'])
def reset_telemetry():
    global machine_state, current_pressure, current_temp, current_vib
    machine_state = 'normal'
    current_pressure = 280.0
    current_temp = 42.0
    current_vib = 1.8
    return jsonify({"status": "success", "message": "Telemetry restored to nominal baseline."})

@app.route('/api/analyze', methods=['POST'])
def force_analyze():
    global is_analyzing, latest_event, current_pressure, current_temp, current_vib, machine_state
    if is_analyzing:
        return jsonify({"status": "busy", "message": "Analysis already in progress."}), 429

    reasons = []
    if current_pressure < THRESHOLDS["pressure_min"]:
        reasons.append(f"Pressure low: {current_pressure:.1f} bar (< {THRESHOLDS['pressure_min']:.1f} bar)")
    elif current_pressure > THRESHOLDS["pressure_max"]:
        reasons.append(f"Pressure high: {current_pressure:.1f} bar (> {THRESHOLDS['pressure_max']:.1f} bar)")

    if current_vib > THRESHOLDS["vibration_max"]:
        reasons.append(f"Vibration high: {current_vib:.2f} mm/s (> {THRESHOLDS['vibration_max']:.1f} mm/s)")

    if current_temp > THRESHOLDS["temperature_max"]:
        reasons.append(f"Temperature high: {current_temp:.1f} °C (> {THRESHOLDS['temperature_max']:.1f} °C)")

    if not reasons:
        reasons.append("Operator manual inspection trigger")

    new_event = create_event_record(reasons, trigger_type="operator_manual")
    with analysis_lock:
        is_analyzing = True
    latest_event = new_event
    recent_events.appendleft(new_event)
    threading.Thread(target=run_ai_analysis_thread, args=(new_event,), daemon=True).start()
    return jsonify({"status": "started", "event_id": new_event["id"]})

@app.route('/api/events')
def list_events():
    return jsonify(list(recent_events))

@app.route('/api/events/<event_id>')
def get_event(event_id):
    for e in recent_events:
        if e["id"] == event_id:
            return jsonify(e)
    return jsonify({"error": "Event not found"}), 404

@app.route('/api/stream')
def stream():
    global current_pressure, current_temp, current_vib, machine_state
    global last_analysis_time, is_analyzing, latest_event, last_skipped_info

    if machine_state == 'normal':
        current_pressure = current_pressure * 0.9 + 280.0 * 0.1 + random.uniform(-1.5, 1.5)
        current_temp = current_temp * 0.9 + 42.0 * 0.1 + random.uniform(-0.4, 0.4)
        current_vib = current_vib * 0.9 + 1.8 * 0.1 + random.uniform(-0.1, 0.1)
    else:
        current_pressure -= random.uniform(2.5, 5.5)
        current_temp += random.uniform(1.2, 2.8)
        current_vib += random.uniform(0.6, 1.8)

    current_pressure = max(0.0, current_pressure)
    current_temp = max(0.0, current_temp)
    current_vib = max(0.0, current_vib)

    reasons = []
    if current_pressure < THRESHOLDS["pressure_min"]:
        reasons.append(f"Pressure low: {current_pressure:.1f} bar (< {THRESHOLDS['pressure_min']:.1f} bar)")
    elif current_pressure > THRESHOLDS["pressure_max"]:
        reasons.append(f"Pressure high: {current_pressure:.1f} bar (> {THRESHOLDS['pressure_max']:.1f} bar)")

    if current_vib > THRESHOLDS["vibration_max"]:
        reasons.append(f"Vibration high: {current_vib:.2f} mm/s (> {THRESHOLDS['vibration_max']:.1f} mm/s)")

    if current_temp > THRESHOLDS["temperature_max"]:
        reasons.append(f"Temperature high: {current_temp:.1f} °C (> {THRESHOLDS['temperature_max']:.1f} °C)")

    anomaly_detected = len(reasons) > 0 or machine_state == 'anomaly'
    now = time.time()
    time_since_last = now - last_analysis_time
    cooldown_remaining = max(0.0, COOLDOWN_SECONDS - time_since_last)

    skip_reason = None
    if anomaly_detected:
        if is_analyzing:
            skip_reason = "Analysis currently running. Telemetry updating live."
        elif cooldown_remaining > 0 and latest_event and latest_event.get("stage") == "completed":
            skip_reason = f"Anomaly active; cooldown running ({cooldown_remaining:.1f}s remaining). Overlapping call suppressed."
        else:
            new_event = create_event_record(reasons, trigger_type="threshold_crossing")
            with analysis_lock:
                is_analyzing = True
            latest_event = new_event
            recent_events.appendleft(new_event)
            threading.Thread(target=run_ai_analysis_thread, args=(new_event,), daemon=True).start()
    else:
        if not is_analyzing:
            skip_reason = "Nominal operation; sensor values within tolerance bounds."

    if skip_reason:
        last_skipped_info = {
            "reason": skip_reason,
            "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
            "cooldown_remaining": round(cooldown_remaining, 1),
            "anomaly_active": anomaly_detected
        }

    insight_text = None
    if latest_event and latest_event.get("final_result"):
        insight_text = latest_event["final_result"].get("explanation")

    return jsonify({
        "pressure": round(current_pressure, 2),
        "temperature": round(current_temp, 2),
        "vibration": round(current_vib, 2),
        "state": machine_state,
        "anomaly_detected": anomaly_detected,
        "trigger_reasons": reasons,
        "thresholds": THRESHOLDS,
        "is_analyzing": is_analyzing,
        "cooldown_remaining": round(cooldown_remaining, 1),
        "cooldown_total": COOLDOWN_SECONDS,
        "skip_info": last_skipped_info,
        "latest_event": latest_event,
        "insight": insight_text
    })

if __name__ == '__main__':
    print("Starting Air-Gapped AI Dashboard on http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
