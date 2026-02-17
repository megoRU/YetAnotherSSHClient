package org.mego;

import com.pty4j.PtyProcess;
import com.pty4j.WinSize;

import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.util.ArrayList;
import java.util.List;

public class Main {

    static void main() {
        SwingUtilities.invokeLater(Main::createAndShowGui);
    }

    private static void createAndShowGui() {
        JFrame frame = new JFrame("Mini SSH Client (PTY)");
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        frame.setSize(1000, 700);

        JTextArea terminal = new JTextArea();
        terminal.setFont(new Font("Monospaced", Font.PLAIN, 14));
        terminal.setLineWrap(false);
        JScrollPane scrollPane = new JScrollPane(terminal);
        frame.add(scrollPane, BorderLayout.CENTER);

        JTextField input = new JTextField();
        frame.add(input, BorderLayout.SOUTH);

        frame.setVisible(true);

        String host = JOptionPane.showInputDialog(frame, "Host:", "77.110.97.210");
        String user = JOptionPane.showInputDialog(frame, "Username:", "root");
        String port = JOptionPane.showInputDialog(frame, "Port:", "12222");

        startSshProcess(terminal, input, user, host, port);
    }

    private static void startSshProcess(JTextArea terminal, JTextField input, String user, String host, String port) {
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add("ssh");
            cmd.add("-p");
            cmd.add(port);
            cmd.add(user + "@" + host);

            PtyProcess process = PtyProcess.exec(cmd.toArray(new String[0]), null, String.valueOf(new File(".")));

            InputStream processOut = process.getInputStream();
            OutputStream processIn = process.getOutputStream();

            // Чтение вывода SSH и отображение в JTextArea
            new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(processOut))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        final String l = line + "\n";
                        SwingUtilities.invokeLater(() -> {
                            terminal.append(l);
                            terminal.setCaretPosition(terminal.getDocument().getLength());
                        });
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }).start();

            // Ввод пользователя
            input.addActionListener(e -> {
                String text = input.getText() + "\n";
                try {
                    processIn.write(text.getBytes());
                    processIn.flush();
                } catch (IOException ex) {
                    ex.printStackTrace();
                }
                input.setText("");
            });

            // Resize terminal
            terminal.addComponentListener(new java.awt.event.ComponentAdapter() {
                public void componentResized(java.awt.event.ComponentEvent evt) {
                    int rows = terminal.getRows();
                    int cols = terminal.getColumns();
                    process.setWinSize(new WinSize(cols, rows));
                }
            });

        } catch (IOException e) {
            e.printStackTrace();
            JOptionPane.showMessageDialog(null, "Error starting SSH: " + e.getMessage());
        }
    }
}