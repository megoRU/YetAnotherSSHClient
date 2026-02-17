package org.mego.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;

public class ConfigManager {
    private static final String CONFIG_FILE = System.getProperty("user.home") + File.separator + ".minissh_config.json";
    private static final String OLD_CONFIG_FILE = System.getProperty("user.home") + File.separator + ".minissh_config.properties";
    private static final String OLD_FAVORITES_FILE = System.getProperty("user.home") + File.separator + ".minissh_favorites.txt";

    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();

    public static class AppConfig {
        public String fontName = "Monospaced";
        public int fontSize = 14;
        public boolean darkTheme = true;
        public int x = 100;
        public int y = 100;
        public int width = 1000;
        public int height = 700;
        public List<ServerInfo> favorites = new ArrayList<>();
    }

    private AppConfig config = new AppConfig();

    public ConfigManager() {
        if (!Files.exists(Paths.get(CONFIG_FILE))) {
            migrate();
        }
        load();
    }

    private void migrate() {
        // Try to load from old properties
        if (Files.exists(Paths.get(OLD_CONFIG_FILE))) {
            Properties props = new Properties();
            try (InputStream in = new FileInputStream(OLD_CONFIG_FILE)) {
                props.load(in);
                config.x = Integer.parseInt(props.getProperty("x", "100"));
                config.y = Integer.parseInt(props.getProperty("y", "100"));
                config.width = Integer.parseInt(props.getProperty("width", "1000"));
                config.height = Integer.parseInt(props.getProperty("height", "700"));
                config.fontName = props.getProperty("fontName", "Monospaced");
                config.fontSize = Integer.parseInt(props.getProperty("fontSize", "14"));
                config.darkTheme = Boolean.parseBoolean(props.getProperty("darkTheme", "true"));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        // Try to load from old favorites
        if (Files.exists(Paths.get(OLD_FAVORITES_FILE))) {
            try {
                List<String> lines = Files.readAllLines(Paths.get(OLD_FAVORITES_FILE));
                for (String line : lines) {
                    if (line.trim().isEmpty()) continue;
                    String[] parts = line.split("\t", 5);
                    if (parts.length >= 4) {
                        String name = parts[0];
                        String user = parts[1];
                        String host = parts[2];
                        String port = parts[3];
                        String password = parts.length == 5 ? decrypt(parts[4]) : "";
                        config.favorites.add(new ServerInfo(name, user, host, port, password));
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        if (config.favorites.size() > 0 || Files.exists(Paths.get(OLD_CONFIG_FILE))) {
            save();
        }
    }

    public void load() {
        if (Files.exists(Paths.get(CONFIG_FILE))) {
            try (Reader reader = Files.newBufferedReader(Paths.get(CONFIG_FILE), StandardCharsets.UTF_8)) {
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
            // We create a copy to avoid changing the in-memory config passwords
            AppConfig copy = gson.fromJson(gson.toJson(config), AppConfig.class);
            for (ServerInfo fav : copy.favorites) {
                fav.password = encrypt(fav.password);
            }
            gson.toJson(copy, writer);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public String getFontName() { return config.fontName; }
    public void setFontName(String name) { config.fontName = name; }

    public int getFontSize() { return config.fontSize; }
    public void setFontSize(int size) { config.fontSize = size; }

    public boolean isDarkTheme() { return config.darkTheme; }
    public void setDarkTheme(boolean dark) { config.darkTheme = dark; }

    public int getX() { return config.x; }
    public void setX(int x) { config.x = x; }

    public int getY() { return config.y; }
    public void setY(int y) { config.y = y; }

    public int getWidth() { return config.width; }
    public void setWidth(int w) { config.width = w; }

    public int getHeight() { return config.height; }
    public void setHeight(int h) { config.height = h; }

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
        return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private String decrypt(String s) {
        if (s == null || s.isEmpty()) return "";
        try {
            return new String(Base64.getDecoder().decode(s), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return s;
        }
    }
}
