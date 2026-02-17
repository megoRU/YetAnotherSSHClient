package org.mego.ui;

import com.formdev.flatlaf.FlatLaf;
import lombok.extern.slf4j.Slf4j;
import org.mego.Main;
import org.mego.config.ConfigManager;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;

@Slf4j
public class SettingsDialog extends JDialog {

    private final JComboBox<String> fontNameCombo;
    private final JSpinner fontSizeSpinner;
    private final JComboBox<String> themeCombo;

    public SettingsDialog(JFrame parent, ConfigManager configManager) {
        super(parent, "Настройки", true);

        JPanel contentPanel = new JPanel(new GridBagLayout());
        contentPanel.setBorder(new EmptyBorder(20, 20, 20, 20));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.insets = new Insets(10, 10, 10, 10);

        gbc.anchor = GridBagConstraints.WEST;

        gbc.gridx = 0;
        gbc.gridy = 0;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Шрифт:"), gbc);

        String[] fonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames();
        fontNameCombo = new JComboBox<>(fonts);
        fontNameCombo.setSelectedItem(configManager.getFontName());
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        contentPanel.add(fontNameCombo, gbc);

        gbc.gridx = 0;
        gbc.gridy = 1;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Размер шрифта:"), gbc);

        fontSizeSpinner = new JSpinner(new SpinnerNumberModel(configManager.getFontSize(), 8, 72, 1));
        fontSizeSpinner.setPreferredSize(new Dimension(60, fontSizeSpinner.getPreferredSize().height));
        // Disable direct editing as requested ("убрать TextAria")
        JComponent editor = fontSizeSpinner.getEditor();
        if (editor instanceof JSpinner.DefaultEditor) {
            JTextField textField = ((JSpinner.DefaultEditor) editor).getTextField();
            textField.setColumns(3);
            textField.setEditable(false);
        }
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.NONE; // Don't stretch the spinner
        contentPanel.add(fontSizeSpinner, gbc);

        gbc.gridx = 0;
        gbc.gridy = 2;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Тема:"), gbc);

        themeCombo = new JComboBox<>(new String[]{"Тёмный", "Светлый"});
        themeCombo.setSelectedItem(configManager.getTheme());
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        contentPanel.add(themeCombo, gbc);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton saveButton = new JButton("Сохранить");
        saveButton.putClientProperty("FlatLaf.style", "arc: 10; background: #0078d4; foreground: #ffffff;");
        saveButton.addActionListener(e -> {
            configManager.setFontName((String) fontNameCombo.getSelectedItem());
            configManager.setFontSize((Integer) fontSizeSpinner.getValue());
            String theme = (String) themeCombo.getSelectedItem();
            configManager.setTheme(theme);
            configManager.save();

            updateTheme(configManager);
            dispose();
        });
        buttonPanel.add(saveButton);

        JButton cancelButton = new JButton("Отмена");
        cancelButton.putClientProperty("FlatLaf.style", "arc: 10;");
        cancelButton.addActionListener(e -> dispose());
        buttonPanel.add(cancelButton);

        gbc.gridx = 0;
        gbc.gridy = 4;
        gbc.gridwidth = 2;
        contentPanel.add(buttonPanel, gbc);

        add(contentPanel);
        setResizable(false);
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
