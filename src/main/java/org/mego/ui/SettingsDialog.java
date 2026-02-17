package org.mego.ui;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.FlatLightLaf;
import lombok.extern.slf4j.Slf4j;
import org.mego.config.ConfigManager;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;

import org.mego.Main;

@Slf4j
public class SettingsDialog extends JDialog {

    private final JComboBox<String> fontNameCombo;
    private final JSpinner fontSizeSpinner;
    private final JComboBox<String> themeCombo;
    private final JComboBox<String> accentCombo;

    private static final String[] ACCENT_NAMES = {"Default", "Blue", "Orange", "Green", "Red", "Violet", "Gruvbox"};
    private static final String[] ACCENT_VALUES = {null, "#0078d4", "#ff8c00", "#107c10", "#d13438", "#881798", "#79740e"};

    public SettingsDialog(JFrame parent, ConfigManager configManager) {
        super(parent, "Настройки программы", true);

        JPanel contentPanel = new JPanel(new GridBagLayout());
        contentPanel.setBorder(new EmptyBorder(20, 20, 20, 20));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.insets = new Insets(10, 10, 10, 10);

        gbc.gridx = 0; gbc.gridy = 0;
        contentPanel.add(new JLabel("Шрифт:"), gbc);
        String[] fonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames();
        fontNameCombo = new JComboBox<>(fonts);
        fontNameCombo.setSelectedItem(configManager.getFontName());
        gbc.gridx = 1;
        contentPanel.add(fontNameCombo, gbc);

        gbc.gridx = 0; gbc.gridy = 1;
        contentPanel.add(new JLabel("Размер шрифта:"), gbc);
        fontSizeSpinner = new JSpinner(new SpinnerNumberModel(configManager.getFontSize(), 8, 72, 1));
        fontSizeSpinner.setPreferredSize(new Dimension(50, fontSizeSpinner.getPreferredSize().height));
        // Disable direct editing as requested ("убрать TextAria")
        JComponent editor = fontSizeSpinner.getEditor();
        if (editor instanceof JSpinner.DefaultEditor) {
            JTextField textField = ((JSpinner.DefaultEditor) editor).getTextField();
            textField.setColumns(2);
            textField.setEditable(false);
        }
        gbc.gridx = 1;
        contentPanel.add(fontSizeSpinner, gbc);

        gbc.gridx = 0; gbc.gridy = 2;
        contentPanel.add(new JLabel("Тема:"), gbc);
        themeCombo = new JComboBox<>(new String[]{"Dark", "Light", "Gruvbox Light"});
        themeCombo.setSelectedItem(configManager.getTheme());
        gbc.gridx = 1;
        contentPanel.add(themeCombo, gbc);

        gbc.gridx = 0; gbc.gridy = 3;
        contentPanel.add(new JLabel("Акцент:"), gbc);
        accentCombo = new JComboBox<>(ACCENT_NAMES);
        String currentAccent = configManager.getAccentColor();
        accentCombo.setSelectedIndex(0);
        for (int i = 0; i < ACCENT_VALUES.length; i++) {
            if (ACCENT_VALUES[i] != null && ACCENT_VALUES[i].equalsIgnoreCase(currentAccent)) {
                accentCombo.setSelectedIndex(i);
                break;
            }
        }
        gbc.gridx = 1;
        contentPanel.add(accentCombo, gbc);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton saveButton = new JButton("Сохранить");
        saveButton.putClientProperty("FlatLaf.style", "arc: 10; background: #0078d4; foreground: #ffffff;");
        saveButton.addActionListener(e -> {
            configManager.setFontName((String) fontNameCombo.getSelectedItem());
            configManager.setFontSize((Integer) fontSizeSpinner.getValue());
            String theme = (String) themeCombo.getSelectedItem();
            configManager.setTheme(theme);
            configManager.setAccentColor(ACCENT_VALUES[accentCombo.getSelectedIndex()]);
            configManager.save();

            updateTheme(configManager);
            dispose();
        });
        buttonPanel.add(saveButton);

        JButton cancelButton = new JButton("Отмена");
        cancelButton.putClientProperty("FlatLaf.style", "arc: 10;");
        cancelButton.addActionListener(e -> dispose());
        buttonPanel.add(cancelButton);

        gbc.gridx = 0; gbc.gridy = 3; gbc.gridwidth = 2;
        contentPanel.add(buttonPanel, gbc);

        add(contentPanel);
        pack();
        setLocationRelativeTo(parent);
    }

    private void updateTheme(ConfigManager configManager) {
        try {
            Main.setupTheme(configManager);
            FlatLaf.updateUI();
        } catch (Exception e) {
            log.error("Unable to update UI", e);
        }
    }
}
