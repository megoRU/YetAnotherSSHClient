package org.mego.ui;

import org.mego.config.ConfigManager;

import javax.swing.*;
import java.awt.*;

public class SettingsDialog extends JDialog {
    private final ConfigManager configManager;
    private final JComboBox<String> fontNameCombo;
    private final JSpinner fontSizeSpinner;

    public SettingsDialog(JFrame parent, ConfigManager configManager) {
        super(parent, "Настройки терминала", true);
        this.configManager = configManager;

        setLayout(new GridLayout(3, 2, 10, 10));

        add(new JLabel("Шрифт:"));
        String[] fonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames();
        fontNameCombo = new JComboBox<>(fonts);
        fontNameCombo.setSelectedItem(configManager.get("fontName", "Monospaced"));
        add(fontNameCombo);

        add(new JLabel("Размер шрифта:"));
        fontSizeSpinner = new JSpinner(new SpinnerNumberModel(configManager.getInt("fontSize", 14), 8, 72, 1));
        add(fontSizeSpinner);

        JButton saveButton = new JButton("Сохранить");
        saveButton.addActionListener(e -> {
            configManager.set("fontName", (String) fontNameCombo.getSelectedItem());
            configManager.setInt("fontSize", (Integer) fontSizeSpinner.getValue());
            configManager.save();
            dispose();
        });
        add(saveButton);

        JButton cancelButton = new JButton("Отмена");
        cancelButton.addActionListener(e -> dispose());
        add(cancelButton);

        pack();
        setLocationRelativeTo(parent);
    }
}
