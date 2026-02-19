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

            if ("GruvboxLight".equals(theme)) {
                UIManager.setLookAndFeel(new com.formdev.flatlaf.FlatLightLaf() {
                    @Override public String getName() { return "GruvboxLight"; }
                });
            } else if ("Light".equals(theme) || "Светлый".equals(theme)) {
                FlatLightLaf.setup();
            } else {
                FlatDarkLaf.setup();
            }

        } catch (Exception e) {
            e.printStackTrace();
        }


        UIManager.put("defaultFont", configManager.getUiFont());
    }

    private static void applyGruvboxColors() {

        Color bg = new Color(251, 241, 199);      // fbf1c7
        Color headerBg = new Color(235, 219, 178); // ebdbb2
        Color fg = new Color(60, 56, 54);          // 3c3836
        Color sel = new Color(213, 196, 161);      // d5c4a1

        // ОСНОВА
        UIManager.put("Panel.background", bg);
        UIManager.put("Panel.foreground", fg);
        UIManager.put("Component.background", bg);
        UIManager.put("Component.foreground", fg);

        // Меню и верхняя панель
        UIManager.put("MenuBar.background", bg);
        UIManager.put("MenuBar.foreground", fg);
        UIManager.put("Menu.background", bg);
        UIManager.put("Menu.foreground", fg);
        UIManager.put("MenuItem.background", bg);
        UIManager.put("MenuItem.foreground", fg);

        // TitlePane теперь автоматически будет bg
        UIManager.put("TitlePane.foreground", fg);

        // Sidebar / Toolbar
        UIManager.put("ToolBar.background", bg);

        // Tabs
        UIManager.put("TabbedPane.background", bg);
        UIManager.put("TabbedPane.selectedBackground", headerBg);
        UIManager.put("TabbedPane.foreground", fg);
        UIManager.put("TabbedPane.selectedForeground", fg);

        // Lists
        UIManager.put("List.background", bg);
        UIManager.put("List.foreground", fg);
        UIManager.put("List.selectionBackground", sel);
        UIManager.put("List.selectionForeground", fg);

        // Inputs
        UIManager.put("TextField.background", bg);
        UIManager.put("TextField.foreground", fg);
        UIManager.put("PasswordField.background", bg);
        UIManager.put("PasswordField.foreground", fg);
        UIManager.put("ComboBox.background", bg);
        UIManager.put("ComboBox.foreground", fg);

        // Buttons
        UIManager.put("Button.background", headerBg);
        UIManager.put("Button.foreground", fg);

        // Borders / focus
        UIManager.put("Component.focusedBorderColor", new Color(146, 131, 116));

        // Scroll
        UIManager.put("ScrollBar.track", bg);
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
