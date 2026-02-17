package org.mego.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.awt.*;
import java.io.File;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

public class ConfigManager {

    private static final String CONFIG_FILE = System.getProperty("user.home") + File.separator + ".minissh_config.json";
    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private static final String ENCRYPTION_ALGORITHM = "AES";

    public static class AppConfig {

        public String fontName = "Monospaced";
        public int fontSize = 14;
        public boolean darkTheme = true;
        public int x = 100;
        public int y = 100;
        public int width = 1000;
        public int height = 700;
        public boolean maximized = false;
        public List<ServerInfo> favorites = new ArrayList<>();
    }

    private AppConfig config = new AppConfig();
    private SecretKeySpec secretKey;

    public ConfigManager() {
        prepareKey();
        load();
    }

    private void prepareKey() {
        try {
            String keyStr = System.getProperty("user.name") + System.getProperty("os.name") + "MiniSSH-Salt-2024";
            System.out.println(keyStr);
            byte[] key = keyStr.getBytes(StandardCharsets.UTF_8);
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            key = sha.digest(key);
            key = Arrays.copyOf(key, 16); // use only first 128 bits
            secretKey = new SecretKeySpec(key, ENCRYPTION_ALGORITHM);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void load() {
        Path path = Paths.get(CONFIG_FILE);
        if (Files.exists(path)) {
            try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
                config = gson.fromJson(reader, AppConfig.class);
                if (config == null) config = new AppConfig();
                // Decrypt passwords after loading
                for (ServerInfo fav : config.favorites) {
                    fav.password = decrypt(fav.password);
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    public void save() {
        try (Writer writer = Files.newBufferedWriter(Paths.get(CONFIG_FILE), StandardCharsets.UTF_8)) {
            // Obfuscate passwords before saving
            AppConfig copy = gson.fromJson(gson.toJson(config), AppConfig.class);
            for (ServerInfo fav : copy.favorites) {
                fav.password = encrypt(fav.password);
            }
            gson.toJson(copy, writer);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public String getFontName() {
        return config.fontName;
    }

    public void setFontName(String name) {
        config.fontName = name;
    }

    public int getFontSize() {
        return config.fontSize;
    }

    public void setFontSize(int size) {
        config.fontSize = size;
    }

    public boolean isDarkTheme() {
        return config.darkTheme;
    }

    public void setDarkTheme(boolean dark) {
        config.darkTheme = dark;
    }

    public int getX() {
        return config.x;
    }

    public void setX(int x) {
        config.x = x;
    }

    public int getY() {
        return config.y;
    }

    public void setY(int y) {
        config.y = y;
    }

    public int getWidth() {
        return config.width;
    }

    public void setWidth(int w) {
        config.width = w;
    }

    public int getHeight() {
        return config.height;
    }

    public void setHeight(int h) {
        config.height = h;
    }

    public boolean isMaximized() {
        return config.maximized;
    }

    public void setMaximized(boolean maximized) {
        config.maximized = maximized;
    }

    public Font getFont() {
        return new Font(config.fontName, Font.PLAIN, config.fontSize);
    }

    public List<ServerInfo> getFavorites() {
        return config.favorites;
    }

    public void addFavorite(ServerInfo fav) {
        config.favorites.add(fav);
        save();
    }

    public void removeFavorite(int index) {
        if (index >= 0 && index < config.favorites.size()) {
            config.favorites.remove(index);
            save();
        }
    }

    public void updateFavorite(int index, ServerInfo fav) {
        if (index >= 0 && index < config.favorites.size()) {
            config.favorites.set(index, fav);
            save();
        }
    }

    private String encrypt(String s) {
        if (s == null || s.isEmpty()) return "";
        try {
            Cipher cipher = Cipher.getInstance(ENCRYPTION_ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            return Base64.getEncoder().encodeToString(cipher.doFinal(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String decrypt(String s) {
        if (s == null || s.isEmpty()) return "";
        try {
            Cipher cipher = Cipher.getInstance(ENCRYPTION_ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey);
            return new String(cipher.doFinal(Base64.getDecoder().decode(s)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            try {
                return new String(Base64.getDecoder().decode(s), StandardCharsets.UTF_8);
            } catch (Exception ex) {
                return s;
            }
        }
    }
}
