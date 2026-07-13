import os
import json
import base64
import re
from flask import Flask, request, jsonify, send_from_directory
from google import genai
from google.genai import types as genai_types
from supabase import create_client, Client

app = Flask(__name__, static_folder='.')

GEMINI_API_KEY    = os.environ.get("GEMINI_API_KEY")
SUPABASE_URL      = os.environ.get("SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")

genai_client = genai.Client(api_key=GEMINI_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# ── Static routes ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify({"supabaseUrl": SUPABASE_URL, "supabaseAnonKey": SUPABASE_ANON_KEY})

# ── Analyse food image ────────────────────────────────────────────────────────

@app.route('/api/analyse', methods=['POST'])
def analyse_food():
    data       = request.json
    user_id    = data.get('userId')
    image_b64  = data.get('image')          # base64 string (no data: prefix)
    mime_type  = data.get('mimeType', 'image/jpeg')
    meal_label = data.get('mealLabel', '')  # breakfast / lunch / dinner / snack

    if not user_id or not image_b64:
        return jsonify({"error": "Missing data"}), 400

    try:
        # Fetch user profile for personalised context
        profile = {}
        try:
            res = supabase.table('profiles').select('*').eq('user_id', user_id).single().execute()
            profile = res.data or {}
        except:
            pass

        goal_str = ""
        if profile.get('calorie_goal'):
            goal_str = f"The user's daily calorie goal is {profile['calorie_goal']} kcal."
        if profile.get('diet_notes'):
            goal_str += f" Diet notes: {profile['diet_notes']}."

        prompt = f"""Analyse this food photo. {goal_str}
Return ONLY valid JSON, no markdown:
{{"dish":"string","confidence":"high|medium|low","servingNote":"string","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0,"sugar_g":0,"sodium_mg":0,"items":[{{"name":"string","calories":0,"amount":"string"}}],"tip":"string"}}"""

        MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
        response = None
        last_err = None
        for model_name in MODELS:
            try:
                response = genai_client.models.generate_content(
                    model=model_name,
                    contents=[
                        genai_types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=mime_type),
                        prompt
                    ]
                )
                print(f"Success with model: {model_name}")
                break
            except Exception as me:
                print(f"Model {model_name} failed: {me}")
                last_err = me
                continue
        if response is None:
            raise last_err

        raw = response.text.strip()
        # Strip markdown fences if present
        raw = re.sub(r'^```json\s*', '', raw)
        raw = re.sub(r'^```\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

        nutrition = json.loads(raw)

        # Save log entry to supabase
        supabase.table('food_logs').insert({
            "user_id":      user_id,
            "meal_label":   meal_label or 'meal',
            "dish":         nutrition.get('dish', 'Unknown'),
            "calories":     nutrition.get('calories', 0),
            "protein_g":    nutrition.get('protein_g', 0),
            "carbs_g":      nutrition.get('carbs_g', 0),
            "fat_g":        nutrition.get('fat_g', 0),
            "fiber_g":      nutrition.get('fiber_g', 0),
            "sugar_g":      nutrition.get('sugar_g', 0),
            "sodium_mg":    nutrition.get('sodium_mg', 0),
            "items_json":   json.dumps(nutrition.get('items', [])),
            "serving_note": nutrition.get('servingNote', ''),
            "tip":          nutrition.get('tip', ''),
            "image_b64":    image_b64[:200] + '...' if len(image_b64) > 200 else image_b64,
        }).execute()

        return jsonify({"nutrition": nutrition, "success": True})

    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e} | raw: {raw}")
        return jsonify({"error": "Could not parse nutrition data — try again."}), 500
    except Exception as e:
        err_str = str(e)
        print(f"Analyse error: {err_str}")
        if 'RESOURCE_EXHAUSTED' in err_str or '429' in err_str:
            return jsonify({"error": "Gemini free quota reached for today. It resets at midnight Pacific time. Try again tomorrow, or upgrade your Google AI API key at aistudio.google.com."}), 429
        return jsonify({"error": "Analysis failed — please try again."}), 500

# ── Food logs ─────────────────────────────────────────────────────────────────

@app.route('/api/logs/<user_id>', methods=['GET'])
def get_logs(user_id):
    date_str = request.args.get('date')  # YYYY-MM-DD
    try:
        query = supabase.table('food_logs').select('*').eq('user_id', user_id)
        if date_str:
            query = query.gte('created_at', f"{date_str}T00:00:00").lte('created_at', f"{date_str}T23:59:59")
        res = query.order('created_at', desc=False).execute()
        return jsonify(res.data or [])
    except Exception as e:
        return jsonify([])

@app.route('/api/logs/<log_id>', methods=['DELETE'])
def delete_log(log_id):
    try:
        supabase.table('food_logs').delete().eq('id', log_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/logs/history/<user_id>', methods=['GET'])
def get_history_logs(user_id):
    """Returns last 7 days aggregated by date"""
    try:
        from datetime import datetime, timedelta
        seven_ago = (datetime.utcnow() - timedelta(days=6)).strftime('%Y-%m-%dT00:00:00')
        res = (supabase.table('food_logs').select('created_at,calories,protein_g,carbs_g,fat_g')
               .eq('user_id', user_id)
               .gte('created_at', seven_ago)
               .order('created_at', desc=False)
               .execute())
        return jsonify(res.data or [])
    except Exception as e:
        return jsonify([])

# ── Profile ───────────────────────────────────────────────────────────────────

@app.route('/api/profile/<user_id>', methods=['GET'])
def get_profile(user_id):
    try:
        res = supabase.table('profiles').select('*').eq('user_id', user_id).single().execute()
        return jsonify(res.data or {})
    except:
        return jsonify({})

@app.route('/api/profile', methods=['POST'])
def save_profile():
    data    = request.json
    user_id = data.get('userId')
    if not user_id:
        return jsonify({"error": "Missing userId"}), 400
    row = {
        "user_id":        user_id,
        "name":           data.get('name'),
        "age":            data.get('age'),
        "weight_kg":      data.get('weight_kg'),
        "height_cm":      data.get('height_cm'),
        "calorie_goal":   data.get('calorie_goal'),
        "diet_type":      data.get('diet_type'),
        "diet_notes":     data.get('diet_notes'),
        "theme_primary":  data.get('theme_primary'),
        "theme_secondary":data.get('theme_secondary'),
        "theme_bg":       data.get('theme_bg'),
        "theme_card":     data.get('theme_card'),
    }
    supabase.table('profiles').upsert(row, on_conflict='user_id').execute()
    return jsonify({"success": True})

# ── Reset account ─────────────────────────────────────────────────────────────

@app.route('/api/reset-account', methods=['POST'])
def reset_account():
    data    = request.json
    user_id = data.get('userId')
    if not user_id:
        return jsonify({"error": "Missing userId"}), 400
    try:
        supabase.table("food_logs").delete().eq("user_id", user_id).execute()
        supabase.table("profiles").delete().eq("user_id", user_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
