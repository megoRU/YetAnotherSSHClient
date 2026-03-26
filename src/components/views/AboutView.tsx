import React from 'react';

const { ipcRenderer } = window as any;

interface AboutViewProps {
    uiFontSize: number;
}

export const AboutView: React.FC<AboutViewProps> = ({ uiFontSize }) => {
    return (
        <div style={{
            padding: '40px',
            textAlign: 'center',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <div style={{ fontSize: `${uiFontSize}px` }}>
                <img src="./icons/icon256.png"
                    style={{ width: '128px', height: '128px', marginBottom: '20px' }}
                    alt="Logo" />
                <br />
                <b style={{ fontSize: '1.5em' }}>YetAnotherSSHClient</b>
                <br /><br />
                Версия: 1.1.7
                <br /><br />
                GitHub: <a href="#" onClick={(e) => {
                    e.preventDefault();
                    ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient');
                }} style={{ color: '#c81e51', textDecoration: 'none' }}>YetAnotherSSHClient</a>
                <br /><br />
                Лицензия: <a href="#" onClick={(e) => {
                    e.preventDefault();
                    ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE');
                }} style={{ color: '#c81e51', textDecoration: 'none' }}>GNU GPL v3</a>
            </div>
        </div>
    );
};
