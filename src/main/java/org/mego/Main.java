package org.mego;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLightLaf;
import org.mego.config.ConfigManager;
import org.mego.ui.MainFrame;

import javax.swing.*;

public class Main {

    public static void main(String[] args) {
        ConfigManager configManager = new ConfigManager();
        setupTheme(configManager.getTheme());

        SwingUtilities.invokeLater(() -> {
            MainFrame frame = new MainFrame(configManager);
            frame.setVisible(true);
        });
    }

    public static void setupTheme(String theme) {
        try {
            UIManager.put("Component.accentColor", null); // Reset accent color
            switch (theme) {
                case "Light":
                    FlatLightLaf.setup();
                    break;
                case "Gruvbox Light":
                    FlatLightLaf.setup();
                    UIManager.put("Component.accentColor", "#79740e");
                    break;
                case "Dark":
                default:
                    FlatDarkLaf.setup();
                    break;
            }
        } catch (Exception e) {
            FlatDarkLaf.setup();
        }
    }
}
