#!/usr/bin/env node

/**
 * This script performs two tasks:
 *
 * 1. Sync extension locales:
 *    - Sort EN file
 *    - Fill missing keys in other languages with `[TODO]` prefix
 *
 * 2. Sync extension → mobile:
 *    - Find missing keys in mobile
 *    - Copy values from extension locales to mobile locales
 *
 * Usage:
 *   node scripts/sync-locales.js
 */

const fs = require('fs')
const path = require('path')

// ========================== CONFIG ==========================

// Extension locale dirs
const EXT_LOCALES_DIR = path.join(__dirname, '../apps/extension/src/_locales')
const EXT_LANGS = ['en', 'zh_TW', 'ja', 'fr', 'es', 'ru']
const TODO_PREFIX = '[TODO] '

// Mobile locale dirs
const MOBILE_LOCALES_DIR = path.join(__dirname, '../apps/unisat-wallet-mobile/assets/_locales')

// Languages to sync to mobile
const MOBILE_LANGS = ['en', 'es', 'fr', 'ja', 'ru', 'zh_TW']

// ========================== UTILITIES ==========================

function loadJson(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

function saveJson(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2) + '\n'
    fs.writeFileSync(filePath, content, 'utf8')
    return true
  } catch (e) {
    return false
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ========================== STEP 1: Sync Extension Locales ==========================

function syncExtensionLocales() {
  console.log('🔄 Step 1: Syncing extension locale files...\n')

  const enPath = path.join(EXT_LOCALES_DIR, 'en/messages.json')
  let enMessages = loadJson(enPath)

  if (!enMessages) {
    console.error('❌ Cannot load extension EN locale file')
    return null
  }

  // Sort EN file
  const sortedEnKeys = Object.keys(enMessages).sort()
  const sortedEnMessages = {}
  for (const key of sortedEnKeys) {
    sortedEnMessages[key] = enMessages[key]
  }

  if (saveJson(enPath, sortedEnMessages)) {
    console.log('✅ Sorted EN file')
  } else {
    console.log('❌ Failed to save sorted EN')
  }

  enMessages = sortedEnMessages
  const enKeys = Object.keys(enMessages)

  console.log(`📊 EN contains ${enKeys.length} keys\n`)

  // Process each extension language
  EXT_LANGS.filter(l => l !== 'en').forEach(locale => {
    const localeDir = path.join(EXT_LOCALES_DIR, locale)
    const filePath = path.join(localeDir, 'messages.json')

    ensureDir(localeDir)

    let messages = loadJson(filePath) || {}

    let added = 0
    let existing = 0
    let todo = 0

    enKeys.forEach(key => {
      if (messages[key]) {
        if (messages[key].message.startsWith(TODO_PREFIX)) {
          todo++
        }
        existing++
      } else {
        messages[key] = { message: TODO_PREFIX + enMessages[key].message }
        added++
        todo++
      }
    })

    // Sort locale file
    const sortedKeys = Object.keys(messages).sort()
    const sortedMessages = {}
    sortedKeys.forEach(k => {
      sortedMessages[k] = messages[k]
    })

    if (saveJson(filePath, sortedMessages)) {
      console.log(`  🌍 ${locale}: existing=${existing}, added=${added}, todo=${todo}`)
    } else {
      console.log(`  ❌ Failed to save ${locale}`)
    }
  })

  console.log('\n✨ Extension locale sync complete!\n')

  return enKeys // return EN keys for next step
}

// ========================== STEP 2: Sync to Mobile ==========================

function syncExtensionToMobile(enKeys) {
  console.log('\n🔄 Step 2: Syncing extension → mobile...\n')

  let totalCopied = 0
  let totalMissing = 0

  MOBILE_LANGS.forEach(lang => {
    console.log(`--- Processing mobile language: ${lang} ---`)

    const extPath = path.join(EXT_LOCALES_DIR, lang, 'messages.json')
    const mobilePath = path.join(MOBILE_LOCALES_DIR, lang, 'messages.json')

    if (!fs.existsSync(extPath)) {
      console.log(`⚠️ Missing extension file: ${extPath}`)
      return
    }
    if (!fs.existsSync(mobilePath)) {
      console.log(`⚠️ Missing mobile file: ${mobilePath}`)
      return
    }

    const extData = loadJson(extPath)
    const mobileData = loadJson(mobilePath)

    if (!extData || !mobileData) {
      console.log(`❌ Failed reading files for language: ${lang}`)
      return
    }

    let copied = 0

    enKeys.forEach(key => {
      if (!mobileData[key] && extData[key]) {
        mobileData[key] = extData[key]
        console.log(`  🔁 ${key}`)
        copied++
      }
    })

    if (saveJson(mobilePath, mobileData)) {
      console.log(`✨ ${lang}: Copied ${copied} keys`)
      totalCopied += copied
    } else {
      console.log(`❌ Failed writing mobile file: ${lang}`)
    }
  })

  console.log('\n📊 Mobile Sync Summary:')
  console.log(`  Copied keys: ${totalCopied}`)
  console.log('\n✨ All locales synchronized!\n')
}

// ========================== RUN ==========================

function main() {
  const enKeys = syncExtensionLocales() // Step 1
  if (!enKeys) return
  syncExtensionToMobile(enKeys) // Step 2
}

main()
