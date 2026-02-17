package org.mego.ui;

import com.formdev.flatlaf.FlatDarkLaf;
import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.FlatLightLaf;
import org.mego.config.ConfigManager;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;

public class SettingsDialog extends JDialog {

    private final JComboBox<String> fontNameCombo;
    private final JSpinner fontSizeSpinner;
    private final JCheckBox darkThemeCheckBox;

    public SettingsDialog(JFrame parent, ConfigManager configManager) {
        super(parent, "Настройки терминала", true);

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
        gbc.gridx = 1;
        contentPanel.add(fontSizeSpinner, gbc);

        gbc.gridx = 0; gbc.gridy = 2;
        contentPanel.add(new JLabel("Темная тема:"), gbc);
        darkThemeCheckBox = new JCheckBox();
        darkThemeCheckBox.setSelected(configManager.isDarkTheme());
        gbc.gridx = 1;
        contentPanel.add(darkThemeCheckBox, gbc);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton saveButton = new JButton("Сохранить");
        saveButton.putClientProperty("FlatLaf.style", "arc: 10; background: #0078d4; foreground: #ffffff;");
        saveButton.addActionListener(e -> {
            configManager.setFontName((String) fontNameCombo.getSelectedItem());
            configManager.setFontSize((Integer) fontSizeSpinner.getValue());
            boolean dark = darkThemeCheckBox.isSelected();
            configManager.setDarkTheme(dark);
            configManager.save();

            updateTheme(dark);
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

    private void updateTheme(boolean dark) {
        try {
            if (dark) {
                UIManager.setLookAndFeel(new FlatDarkLaf());
            } else {
                UIManager.setLookAndFeel(new FlatLightLaf());
            }
            FlatLaf.updateUI();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
