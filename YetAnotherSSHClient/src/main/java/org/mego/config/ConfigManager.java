package org.mego.config;

import java.awt.*;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Properties;

public class ConfigManager {
    private static final String CONFIG_FILE = System.getProperty("user.home") + File.separator + ".minissh_config.properties";
    private Properties props = new Properties();

    public ConfigManager() {
        load();
    }

    public void load() {
        if (Files.exists(Paths.get(CONFIG_FILE))) {
            try (InputStream in = new FileInputStream(CONFIG_FILE)) {
                props.load(in);
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    public void save() {
        try (OutputStream out = new FileOutputStream(CONFIG_FILE)) {
            props.store(out, "SSH Client Config");
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public String get(String key, String defaultValue) {
        return props.getProperty(key, defaultValue);
    }

    public void set(String key, String value) {
        props.setProperty(key, value);
    }

    public int getInt(String key, int defaultValue) {
        try {
            return Integer.parseInt(props.getProperty(key, String.valueOf(defaultValue)));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    public void setInt(String key, int value) {
        props.setProperty(key, String.valueOf(value));
    }

    public Font getFont() {
        String name = get("fontName", "Monospaced");
        int size = getInt("fontSize", 14);
        return new Font(name, Font.PLAIN, size);
    }

    public void setFont(Font font) {
        set("fontName", font.getName());
        setInt("fontSize", font.getSize());
    }
}
