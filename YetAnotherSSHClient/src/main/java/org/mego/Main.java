package org.mego;

import com.formdev.flatlaf.FlatDarkLaf;
import org.mego.ui.MainFrame;
import javax.swing.*;

public class Main {
    public static void main(String[] args) {
        FlatDarkLaf.setup();
        SwingUtilities.invokeLater(() -> {
            MainFrame frame = new MainFrame();
            frame.setVisible(true);
        });
    }
}
