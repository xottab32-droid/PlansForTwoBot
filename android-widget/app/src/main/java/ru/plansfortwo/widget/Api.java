package ru.plansfortwo.widget;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

final class Api {
    private static final String ENDPOINT = "https://ccqbxfspjmlzizzznsuz.supabase.co/functions/v1/plans-widget";
    static final long DAY = 24L * 60L * 60L * 1000L;
    static final Object LOCK = new Object();
    private Api() {}
    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("couple_widget", Context.MODE_PRIVATE); }
    static String randomHex(int bytes) {
        byte[] b = new byte[bytes]; new SecureRandom().nextBytes(b);
        char[] chars = "0123456789abcdef".toCharArray(); StringBuilder s = new StringBuilder();
        for (byte v : b) { s.append(chars[(v & 255) >>> 4]); s.append(chars[v & 15]); }
        return s.toString();
    }
    static JSONObject request(JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ENDPOINT).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(12000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        try {
            byte[] json = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.getOutputStream().write(json);
            int status = connection.getResponseCode();
            InputStream in = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n;
            if (in != null) { while ((n = in.read(b)) != -1) buf.write(b,0,n); in.close(); }
            JSONObject result = new JSONObject(buf.toString("UTF-8").isEmpty() ? "{}" : buf.toString("UTF-8"));
            if (status >= 400) throw new Exception(result.optString("error", "HTTP " + status));
            return result;
        } finally { connection.disconnect(); }
    }
    static JSONObject register(String code, String token) throws Exception {
        return request(new JSONObject().put("action","register").put("code",code).put("token",token));
    }
    static JSONObject fetch(Context c, boolean force) throws Exception {
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            String token = p.getString("token", "");
            if (token.isEmpty()) throw new Exception("Привяжи Telegram в приложении");
            long last = p.getLong("last_auto", 0);
            if (!force && last > 0 && System.currentTimeMillis() - last < DAY) {
                return new JSONObject(p.getString("snapshot", "{}"));
            }
            JSONObject data = request(new JSONObject().put("action","snapshot").put("token", token));
            if ("pending".equals(data.optString("status"))) throw new Exception("Ожидается подтверждение в Telegram");
            if (!"ready".equals(data.optString("status"))) throw new Exception("Не удалось прочитать данные пары");
            p.edit().putString("snapshot", data.toString()).putLong("last_auto",System.currentTimeMillis()).apply();
            return data;
        }
    }
}
