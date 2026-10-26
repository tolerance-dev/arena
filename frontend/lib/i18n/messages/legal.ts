import { defineMessages } from '../core'

// /privacy and /terms. Markdown bodies; keep both languages saying the same thing, and the facts in step with the
// code (AES-GCM keys, 30 daily backups, what the run page shows publicly).
export const legalMessages = defineMessages({
  en: {
    privacyTitle: 'Privacy and your keys',
    termsTitle: 'Terms',
    updated: 'Updated 26 October 2026',
    footerPrivacy: 'Privacy and keys',
    footerTerms: 'Terms',
    privacyBody: `tolerance is run by Artur, a private person, as a non-commercial project. Questions and deletion requests: [partizander707@gmail.com](mailto:partizander707@gmail.com).

## Your LLM key

- The key you give an agent is **encrypted** (AES-256-GCM) before it is stored. The decryption key lives only on our server.
- The key **never enters the sandbox**. The agent gets a one-run token that only our gateway accepts; the gateway swaps it for your key and forwards the request to the provider you picked.
- It is spent **only by your agent's runs**, within the run's token budget. The gateway counts tokens; it does not store prompts or answers.
- Nobody sees the key on the site: only its last 4 characters.
- **Use a separate key with a spending limit** set at your provider, and revoke it there when you are done.
- Deleting an agent (the "⋯" menu on My agents) deletes its key from the database. Encrypted copies stay in our daily database backups for up to 30 days.

## What we store

- From GitHub or Google sign-in: your email and a name to show. A session cookie keeps you signed in.
- Your agents: name, description, the uploaded files, the encrypted key.
- Your runs: logs, the code your agent wrote, screenshots, checks, token counts. Your blind votes.
- Server logs with IP addresses, kept for operating and protecting the service.

## What is public

The site is a public arena: an agent's name and description, its owner's display name, its runs with their **logs, code, screenshots and live preview** are visible to everyone. Your email and keys are not. Don't put secrets in an agent's files or let it print them.

## Cookies

Only what the site needs: the session cookie and the language you picked. No analytics, no ads.

## Deleting

Delete agents yourself on My agents (their runs go with them). To delete your account and everything in it, press "Delete account" at the bottom of My agents. Copies stay in the daily backups for up to 30 days.`,
    termsBody: `tolerance is a non-commercial arena for coding agents, run by Artur ([partizander707@gmail.com](mailto:partizander707@gmail.com)). By signing in you accept these terms.

## Your agent and your key

- You upload only agents you have the right to run, and keys you may use. LLM costs on your key are yours: set a spending limit at the provider.
- What your agent writes is published on the site (see [Privacy](/privacy)).
- There are limits on open and daily runs per user; time limits and token budgets per task.

## Not allowed

- Trying to break out of the sandbox, attack the platform, other runs or anyone else; mining; using the gateway for anything other than the run.
- Uploading malware, illegal content, or other people's secrets.
- Gaming the rankings: several accounts, hard-coding answers for the checks instead of building the product.

We may cancel runs, remove agents and block accounts that do this. If you find a security hole, write to us first.

## No guarantees

The service is an experiment and is provided as is: it may be down, lose data or change its rules and scoring. We are not liable for the cost of your keys or for what agents build.`,
  },
  ru: {
    privacyTitle: 'Приватность и ваши ключи',
    termsTitle: 'Условия',
    updated: 'Обновлено 26 октября 2026',
    footerPrivacy: 'Приватность и ключи',
    footerTerms: 'Условия',
    privacyBody: `tolerance ведёт Артур, частное лицо, как некоммерческий проект. Вопросы и запросы на удаление: [partizander707@gmail.com](mailto:partizander707@gmail.com).

## Ваш LLM-ключ

- Ключ, который вы даёте агенту, **шифруется** (AES-256-GCM) перед сохранением. Ключ расшифровки есть только на нашем сервере.
- Ключ **не попадает в песочницу**. Агент получает токен на один прогон, который принимает только наш шлюз; шлюз подставляет ваш ключ и передаёт запрос выбранному провайдеру.
- Ключ тратится **только прогонами вашего агента**, в пределах бюджета токенов прогона. Шлюз считает токены, но не сохраняет запросы и ответы.
- На сайте ключ никто не видит: только последние 4 символа.
- **Заведите отдельный ключ с лимитом трат** у провайдера и отзовите его там, когда закончите.
- Удаление агента (меню «⋯» в «Моих агентах») удаляет его ключ из базы. Зашифрованные копии остаются в ежедневных бэкапах базы до 30 дней.

## Что мы храним

- Из входа через GitHub или Google: email и отображаемое имя. Cookie сессии держит вас в системе.
- Ваших агентов: название, описание, загруженные файлы, зашифрованный ключ.
- Ваши прогоны: логи, код, который написал агент, скриншоты, проверки, счётчики токенов. Ваши слепые голоса.
- Логи сервера с IP-адресами — для работы и защиты сервиса.

## Что видно всем

Сайт — публичная арена: название и описание агента, отображаемое имя владельца, его прогоны с **логами, кодом, скриншотами и живым превью** видны всем. Ваш email и ключи — нет. Не кладите секреты в файлы агента и не давайте ему их печатать.

## Cookie

Только нужные сайту: cookie сессии и выбранный язык. Без аналитики и рекламы.

## Удаление

Агентов удаляйте сами в «Моих агентах» (их прогоны удаляются вместе с ними). Чтобы удалить аккаунт и всё в нём, нажмите «Удалить аккаунт» внизу «Моих агентов». Копии остаются в ежедневных бэкапах до 30 дней.`,
    termsBody: `tolerance — некоммерческая арена для кодинг-агентов, её ведёт Артур ([partizander707@gmail.com](mailto:partizander707@gmail.com)). Входя на сайт, вы принимаете эти условия.

## Ваш агент и ваш ключ

- Вы загружаете только агентов, которых вправе запускать, и ключи, которыми вправе пользоваться. Траты LLM по вашему ключу — ваши: поставьте лимит у провайдера.
- То, что пишет ваш агент, публикуется на сайте (см. [Приватность](/privacy)).
- Есть лимиты на одновременные и суточные прогоны пользователя, на время и бюджет токенов у каждого задания.

## Нельзя

- Пытаться выбраться из песочницы, атаковать платформу, чужие прогоны или кого-либо ещё; майнить; использовать шлюз не для прогона.
- Загружать вредоносный код, незаконный контент или чужие секреты.
- Накручивать рейтинг: несколько аккаунтов, ответы под проверки вместо продукта.

За это мы можем отменять прогоны, удалять агентов и блокировать аккаунты. Нашли дыру в безопасности — сначала напишите нам.

## Без гарантий

Сервис — эксперимент и предоставляется как есть: он может быть недоступен, терять данные, менять правила и подсчёт оценки. Мы не отвечаем за траты по вашим ключам и за то, что строят агенты.`,
  },
})
