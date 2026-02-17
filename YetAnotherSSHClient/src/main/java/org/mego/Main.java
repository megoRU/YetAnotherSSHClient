package org.mego;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLightLaf;
import org.mego.config.ConfigManager;
import org.mego.ui.MainFrame;
import javax.swing.*;

public class Main {
    public static void main(String[] args) {
        ConfigManager configManager = new ConfigManager();
        if (configManager.isDarkTheme()) {
            FlatDarkLaf.setup();
        } else {
            FlatLightLaf.setup();
        }

        SwingUtilities.invokeLater(() -> {
            MainFrame frame = new MainFrame(configManager);
            frame.setVisible(true);
        });
    }
}
