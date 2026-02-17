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

        if ("Light".equals(theme) || "Светлый".equals(theme)) {
            FlatLightLaf.setup();
        } else {
            FlatDarkLaf.setup();
        }

        UIManager.put("defaultFont", configManager.getFont());
    }
}
