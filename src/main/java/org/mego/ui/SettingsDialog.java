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

    private final JComboBox<String> uiFontNameCombo;
    private final JSpinner uiFontSizeSpinner;
    private final JComboBox<String> terminalFontNameCombo;
    private final JSpinner terminalFontSizeSpinner;
    private final JComboBox<String> themeCombo;

    public SettingsDialog(JFrame parent, ConfigManager configManager) {
        super(parent, "Настройки", true);

        JPanel contentPanel = new JPanel(new GridBagLayout());
        contentPanel.setBorder(new EmptyBorder(20, 20, 20, 20));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.insets = new Insets(10, 10, 10, 10);

        gbc.anchor = GridBagConstraints.WEST;

        String[] fonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames();

        int row = 0;
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Шрифт программы:"), gbc);

        uiFontNameCombo = new JComboBox<>(fonts);
        uiFontNameCombo.setSelectedItem(configManager.getUiFontName());
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        contentPanel.add(uiFontNameCombo, gbc);

        row++;
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Размер шрифта программы:"), gbc);

        uiFontSizeSpinner = createFontSizeSpinner(configManager.getUiFontSize());
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(uiFontSizeSpinner, gbc);

        row++;
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Шрифт терминала:"), gbc);

        terminalFontNameCombo = new JComboBox<>(fonts);
        terminalFontNameCombo.setSelectedItem(configManager.getTerminalFontName());
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        contentPanel.add(terminalFontNameCombo, gbc);

        row++;
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(new JLabel("Размер шрифта терминала:"), gbc);

        terminalFontSizeSpinner = createFontSizeSpinner(configManager.getTerminalFontSize());
        gbc.gridx = 1;
        gbc.fill = GridBagConstraints.NONE;
        contentPanel.add(terminalFontSizeSpinner, gbc);

        row++;
        gbc.gridx = 0;
        gbc.gridy = row;
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
            configManager.setUiFontName((String) uiFontNameCombo.getSelectedItem());
            configManager.setUiFontSize((Integer) uiFontSizeSpinner.getValue());
            configManager.setTerminalFontName((String) terminalFontNameCombo.getSelectedItem());
            configManager.setTerminalFontSize((Integer) terminalFontSizeSpinner.getValue());
            String theme = (String) themeCombo.getSelectedItem();
            configManager.setTheme(theme);
            configManager.save();

            updateTheme(configManager);
            dispose();
        });
        buttonPanel.add(saveButton);

        // Разделитель
        buttonPanel.add(Box.createRigidArea(new Dimension(10, 0))); // отступ
        JSeparator separator = new JSeparator(SwingConstants.VERTICAL);
        separator.setMaximumSize(new Dimension(2, 25));
        buttonPanel.add(separator);
        buttonPanel.add(Box.createRigidArea(new Dimension(10, 0))); // отступ после разделителя

        JButton cancelButton = new JButton("Отмена");
        cancelButton.putClientProperty("FlatLaf.style", "arc: 10;");
        cancelButton.addActionListener(e -> dispose());
        buttonPanel.add(cancelButton);

        row++;
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.gridwidth = 2;
        contentPanel.add(buttonPanel, gbc);

        add(contentPanel);
        setResizable(false);
        pack();
        setLocationRelativeTo(parent);
    }

    private JSpinner createFontSizeSpinner(int initialValue) {
        JSpinner spinner = new JSpinner(new SpinnerNumberModel(initialValue, 8, 72, 1));
        spinner.setPreferredSize(new Dimension(70, spinner.getPreferredSize().height)); // чуть шире
        JComponent editor = spinner.getEditor();
        if (editor instanceof JSpinner.DefaultEditor) {
            JTextField textField = ((JSpinner.DefaultEditor) editor).getTextField();
            textField.setColumns(3);
            textField.setEditable(false);
            textField.setFont(textField.getFont().deriveFont(16f)); // увеличиваем шрифт
        }
        return spinner;
    }

    private void updateTheme(ConfigManager configManager) {
        try {
            Main.setupTheme(configManager);
            FlatLaf.updateUI();
        } catch (Exception e) {
            LOGGER.error("Unable to update UI", e);
        }
    }
}
