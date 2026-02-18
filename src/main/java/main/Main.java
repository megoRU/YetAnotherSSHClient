package main;

import com.formdev.flatlaf.FlatDarkLaf;
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

        if ("Light".equals(theme) || "Светлый".equals(theme) || "Gruvbox Light".equals(theme)) {
            FlatLightLaf.setup();
            if ("Gruvbox Light".equals(theme)) {
                Color bg = new Color(251, 241, 199);
                Color fg = new Color(60, 56, 54);
                Color sel = new Color(213, 196, 161);

                UIManager.put("Panel.background", bg);
                UIManager.put("ScrollPane.background", bg);
                UIManager.put("TabbedPane.background", bg);
                UIManager.put("TabbedPane.selectedBackground", bg);
                UIManager.put("List.background", bg);
                UIManager.put("List.foreground", fg);
                UIManager.put("List.selectionBackground", sel);
                UIManager.put("List.selectionForeground", fg);
                UIManager.put("Label.foreground", fg);
                UIManager.put("MenuBar.background", bg);
                UIManager.put("Menu.background", bg);
                UIManager.put("Menu.foreground", fg);
                UIManager.put("MenuItem.background", bg);
                UIManager.put("MenuItem.foreground", fg);
                UIManager.put("ToolBar.background", bg);
                UIManager.put("CheckBox.background", bg);
                UIManager.put("CheckBox.foreground", fg);
                UIManager.put("RadioButton.background", bg);
                UIManager.put("RadioButton.foreground", fg);
                UIManager.put("TitledBorder.titleColor", fg);
                UIManager.put("TextField.background", bg);
                UIManager.put("TextField.foreground", fg);
                UIManager.put("PasswordField.background", bg);
                UIManager.put("PasswordField.foreground", fg);
                UIManager.put("ComboBox.background", bg);
                UIManager.put("ComboBox.foreground", fg);
                UIManager.put("Button.background", bg);
                UIManager.put("Button.foreground", fg);
            }
        } else {
            FlatDarkLaf.setup();
        }

        UIManager.put("defaultFont", configManager.getUiFont());
    }
}
