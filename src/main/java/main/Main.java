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

        // Включаем декорации окон FlatLaf
        JFrame.setDefaultLookAndFeelDecorated(true);
        JDialog.setDefaultLookAndFeelDecorated(true);

        try {
            if ("Light".equals(theme) || "Светлый".equals(theme) || "Gruvbox Light".equals(theme)) {
                FlatLightLaf.setup();
                if ("Gruvbox Light".equals(theme)) {
                    applyGruvboxColors();
                } else {
                    resetCustomColors();
                }
            } else {
                FlatDarkLaf.setup();
                resetCustomColors();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        UIManager.put("defaultFont", configManager.getUiFont());
        // Дополнительные глобальные настройки FlatLaf
        UIManager.put("Button.arc", 10);
        UIManager.put("Component.arc", 10);
        UIManager.put("TextComponent.arc", 10);
        UIManager.put("CheckBox.arc", 10);
        UIManager.put("ProgressBar.arc", 10);

        // Интеграция меню в заголовок и единый фон
        UIManager.put("TitlePane.menuBarEmbedded", true);
        UIManager.put("TitlePane.unifiedBackground", true);
    }

    private static void applyGruvboxColors() {
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
        UIManager.put("MenuBar.foreground", fg);
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
        UIManager.put("ScrollBar.track", new Color(0, 0, 0, 0));
    }

    private static void resetCustomColors() {
        String[] keys = {
                "Panel.background", "ScrollPane.background", "TabbedPane.background",
                "TabbedPane.selectedBackground", "List.background", "List.foreground",
                "List.selectionBackground", "List.selectionForeground", "Label.foreground",
                "MenuBar.background", "MenuBar.foreground", "Menu.background", "Menu.foreground",
                "MenuItem.background", "MenuItem.foreground", "ToolBar.background",
                "CheckBox.background", "CheckBox.foreground", "RadioButton.background",
                "RadioButton.foreground", "TitledBorder.titleColor", "TextField.background",
                "TextField.foreground", "PasswordField.background", "PasswordField.foreground",
                "ComboBox.background", "ComboBox.foreground", "Button.background", "Button.foreground",
                "ScrollBar.track"
        };
        for (String key : keys) {
            UIManager.put(key, null);
        }
    }
}
