package main;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLightLaf;
import main.config.ConfigManager;
import main.ui.MainFrame;

import javax.swing.*;

public class Main {

    public static void main(String[] args) {
        ConfigManager configManager = new ConfigManager();
        setupTheme(configManager);

        SwingUtilities.invokeLater(() -> {
            MainFrame frame = new MainFrame(configManager);
            frame.setVisible(true);
        });
    }

    public static void setupTheme(ConfigManager configManager) {
        String theme = configManager.getTheme();

        if ("Light".equals(theme) || "Светлый".equals(theme) || "Gruvbox Light".equals(theme)) {
            FlatLightLaf.setup();
        } else {
            FlatDarkLaf.setup();
        }

        UIManager.put("defaultFont", configManager.getUiFont());
    }
}
