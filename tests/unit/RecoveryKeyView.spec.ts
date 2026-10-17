import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RecoveryKeyView from '../../src/components/RecoveryKeyView.vue'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('RecoveryKeyView', () => {
  it('shows confirmation after the key is copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const wrapper = mount(RecoveryKeyView, { props: { recoveryKey: 'a'.repeat(64) } })

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('a'.repeat(64))
    expect(wrapper.get('button').text()).toBe('Copied!')
    expect(wrapper.get('[role="status"]').text()).toContain('copied to clipboard')
  })

  it('shows a manual-copy instruction when clipboard access fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const wrapper = mount(RecoveryKeyView, { props: { recoveryKey: 'b'.repeat(64) } })

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.get('button').text()).toBe('Try copying again')
    expect(wrapper.get('[role="status"]').text()).toContain('copy it manually')
  })
})
