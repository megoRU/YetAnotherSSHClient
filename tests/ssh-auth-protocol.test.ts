import { describe, it, expect } from 'vitest'
import { isLoginRequiredStatus, LOGIN_REQUIRED_STATUS, MAX_AUTH_ATTEMPTS } from '../src/ipc/ssh.js'
import { buildKeyboardResponses } from '../electron/src/ssh-auth.js'

describe('статус LOGIN_REQUIRED', () => {
    it('распознаёт только точный статус', () => {
        expect(isLoginRequiredStatus('LOGIN_REQUIRED')).toBe(true)
    })

    it('main отправляет маркер, который понимает рендерер', () => {
        expect(LOGIN_REQUIRED_STATUS).toBe('LOGIN_REQUIRED')
        expect(isLoginRequiredStatus(LOGIN_REQUIRED_STATUS)).toBe(true)
        // Локализованный текст маркером не является: показывать окно ввода он не должен
        expect(isLoginRequiredStatus('Требуется логин')).toBe(false)
        expect(isLoginRequiredStatus('Login required')).toBe(false)
    })

    it('не путает с обычными статусами подключения', () => {
        expect(isLoginRequiredStatus('Соединение...')).toBe(false)
        expect(isLoginRequiredStatus('Установлено соединение')).toBe(false)
        expect(isLoginRequiredStatus('AUTH_FAILURE:Неверный логин или пароль')).toBe(false)
    })

    it('не принимает устаревший формат со списком полей', () => {
        expect(isLoginRequiredStatus('CREDENTIALS_REQUIRED:user,password')).toBe(false)
        expect(isLoginRequiredStatus('LOGIN_REQUIRED:user')).toBe(false)
    })
})

describe('лимит попыток авторизации', () => {
    it('ограничен несколькими попытками ввода', () => {
        expect(MAX_AUTH_ATTEMPTS).toBe(3)
    })
})

describe('ответы на keyboard-interactive', () => {
    it('для одного приглашения отправляет ровно один ответ', () => {
        expect(buildKeyboardResponses('secret', 1)).toEqual(['secret'])
    })

    it('без приглашений ответы не отправляются', () => {
        expect(buildKeyboardResponses('secret', 0)).toEqual([])
        expect(buildKeyboardResponses('secret', -3)).toEqual([])
    })

    it('дополнительные приглашения получают пустые ответы, а не undefined', () => {
        expect(buildKeyboardResponses('pw', 3)).toEqual(['pw', '', ''])
        const responses = buildKeyboardResponses('pw', 2)
        expect(responses).toHaveLength(2)
        expect(responses.every(r => typeof r === 'string')).toBe(true)
    })
})
