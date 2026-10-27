import { ApiError } from './api'
import type { T } from './i18n'

// API errors: the server answers {code, message} in English; known codes get a text in the reader's language,
// anything else falls back to the server's text. Exported for per-field codes (ApiError.fields).
export function byCode(code: string, t: T): string | undefined {
  switch (code) {
    case 'network': return t('Нет связи с сервером.', 'Cannot reach the server.')
    case 'unauthenticated': return t('Нужно войти.', 'Please sign in.')
    case 'forbidden': return t('Нет доступа.', 'Access denied.')
    case 'not_found': return t('Не найдено.', 'Not found.')
    case 'internal_error': return t('Внутренняя ошибка. Попробуйте ещё раз.', 'Internal error. Please try again.')
    case 'state_conflict': return t('Сейчас это сделать нельзя.', 'This can’t be done right now.')
    case 'invalid_body': return t('Запрос некорректен.', 'Invalid request.')
    case 'runs_closed': return t('Новые агенты и запуски сейчас на паузе. Попробуйте позже.', 'New agents and runs are paused right now. Try again later.')
    case 'blocked': return t('Вашему аккаунту нельзя загружать агентов и запускать прогоны.', 'Your account may not upload agents or start runs.')
    case 'too_many_runs': return t('Достигнут лимит запусков: дождитесь, пока закончатся идущие прогоны, или попробуйте завтра.', 'Run limit reached: wait for your runs in progress to finish, or try again tomorrow.')
    case 'too_many_agents': return t('Достигнут лимит агентов: удалите одного, чтобы добавить нового.', 'Agent limit reached: delete one to add another.')
    case 'key_rejected': return t('Провайдер не принял ключ: проверьте, что он скопирован целиком, не отозван и подходит выбранному провайдеру.', 'The provider rejected the key: check that it was copied whole, isn’t revoked and belongs to the chosen provider.')
    case 'key_blocked': return t('Google не пускает этот ключ к Gemini API: создайте ключ в AI Studio (aistudio.google.com/apikey) или разрешите ему Generative Language API в Google Cloud Console.', 'Google doesn’t let this key use the Gemini API: create a key in AI Studio (aistudio.google.com/apikey) or allow the Generative Language API for it in the Google Cloud Console.')
    case 'key_malformed': return t('Не похоже на API-ключ: проверьте, что он скопирован целиком, без пробелов.', 'That doesn’t look like an API key: check that it was copied whole, without spaces.')
    case 'keys_rejected': return t('Не все ключи прошли проверку, ни один агент не создан.', 'Not every key passed the check: no agent was created.')
    case 'key_is_subscription': return t('Это токен подписки Claude: выберите провайдера «Подписка Claude».', 'This is a Claude subscription token: choose the “Claude subscription” provider.')
    case 'key_is_api_key': return t('Это API-ключ Anthropic: выберите провайдера «Anthropic».', 'This is an Anthropic API key: choose the “Anthropic” provider.')
    case 'tournament_running': return t('Прошлый турнир ещё идёт: новый можно запустить, когда закончатся его прогоны.', 'The last tournament is still going: a new one can start once its runs finish.')
    case 'tournament_no_agents': return t('У владельца сайта нет готовых агентов: добавьте их в «Мои агенты».', 'The site owner has no ready agents: add them in “My agents”.')
    case 'not_owner': return t('Турниром управляет только владелец сайта.', 'Only the site owner runs the tournament.')
  }
}

// Any error thrown by api()/post()/upload(). Validation messages (invalid_agent, invalid_run) come from the server
// in English and are shown as they are.
export function errorText(err: unknown, t: T): string {
  const generic = t('Что-то пошло не так. Попробуйте ещё раз.', 'Something went wrong. Please try again.')
  if (!(err instanceof ApiError)) return generic
  const { code, message, status } = err
  // Per-user limits answer 429 too, but they are not rate limiting.
  if (code === 'too_many_runs' || code === 'too_many_agents') return byCode(code, t)!
  if (status === 429) {
    return err.retryAfterSec
      ? t(`Слишком много запросов, повторите через ${err.retryAfterSec} с.`, `Too many requests, try again in ${err.retryAfterSec}s.`)
      : t('Слишком много запросов, повторите чуть позже.', 'Too many requests, try again a bit later.')
  }
  if (status === 413) return t('Файл слишком большой.', 'The file is too large.')
  const known = byCode(code, t)
  if (status >= 500 && !known) return byCode('internal_error', t)!
  if (code.startsWith('invalid_') && code !== 'invalid_body' && message) return message
  return known ?? (message || generic)
}
