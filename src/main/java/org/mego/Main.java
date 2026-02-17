package org.mego;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLightLaf;
import org.mego.config.ConfigManager;
import org.mego.ui.MainFrame;

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
        String accentColor = configManager.getAccentColor();

        // If theme is Gruvbox Light and no accent is selected, use Gruvbox green
        if ("Gruvbox Light".equals(theme) && accentColor == null) {
            accentColor = "#79740e";
        }

        try {
            UIManager.put("Component.accentColor", accentColor);
            if ("Light".equals(theme) || "Gruvbox Light".equals(theme)) {
                FlatLightLaf.setup();
            } else {
                FlatDarkLaf.setup();
            }
        } catch (Exception e) {
            FlatDarkLaf.setup();
        }
    }
}
