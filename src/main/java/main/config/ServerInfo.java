package main.config;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class ServerInfo {
    public String name;
    public String user;
    public String host;
    public String port;
    public String password;
    public String identityFile;

}