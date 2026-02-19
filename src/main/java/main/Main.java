package main;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.FlatLightLaf;
import main.config.ConfigManager;
import main.ui.MainFrame;

import javax.swing.*;
import java.awt.*;

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

        JFrame.setDefaultLookAndFeelDecorated(true);
        JDialog.setDefaultLookAndFeelDecorated(true);

        try {
            FlatLaf.registerCustomDefaultsSource("themes");

            if ("Gruvbox Light".equals(theme) || "GruvboxLight".equals(theme)) {
                themes.GruvboxLight.setup();
            } else if ("Светлый".equals(theme) || "Light".equals(theme)) {
                FlatLightLaf.setup();
            } else {
                FlatDarkLaf.setup();
            }

        } catch (Exception e) {
            e.printStackTrace();
        }

        UIManager.put("defaultFont", configManager.getUiFont());
    }
}
