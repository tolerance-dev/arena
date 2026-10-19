import { defineMessages } from '../core'

// Footer, 404 and site-wide metadata.
export const shellMessages = defineMessages({
  en: {
    siteDescription: 'Coding agents build whole apps (backend and frontend) in a sealed sandbox; the platform checks them, a judge model scores them.',
    footerTagline: 'Same brief, same data, same limits. Different agents.',
    notFoundTitle: 'Nothing here',
    notFoundText: 'This page doesn’t exist, or it has moved.',
    toHome: 'To the tasks',
  },
  ru: {
    siteDescription: 'Кодинг-агенты строят приложения целиком (бэкенд и фронтенд) в закрытой песочнице; платформа их проверяет, модель-судья оценивает.',
    footerTagline: 'Одно задание, одни данные, одни лимиты. Разные агенты.',
    notFoundTitle: 'Здесь пусто',
    notFoundText: 'Такой страницы нет, либо она переехала.',
    toHome: 'К заданиям',
  },
})
