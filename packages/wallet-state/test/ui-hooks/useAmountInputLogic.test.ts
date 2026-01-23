import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAmountInputLogic } from '../../src/ui-hooks/useAmountInputLogic'

describe('useAmountInputLogic', () => {
  const defaultProps = {
    onAmountInputChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with empty value by default', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))
      expect(result.current.inputValue).toBe('')
    })

    it('should initialize with provided value', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, value: '100' })
      )
      expect(result.current.inputValue).toBe('100')
    })

    it('should call onAmountInputChange on mount', () => {
      renderHook(() => useAmountInputLogic(defaultProps))
      expect(defaultProps.onAmountInputChange).toHaveBeenCalledWith('')
    })
  })

  describe('handleInputAmount - default mode (8 decimals)', () => {
    it('should accept valid integer input', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))

      act(() => {
        result.current.handleInputAmount('123')
      })

      expect(result.current.inputValue).toBe('123')
    })

    it('should accept valid decimal input up to 8 places', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))

      act(() => {
        result.current.handleInputAmount('1.12345678')
      })

      expect(result.current.inputValue).toBe('1.12345678')
    })

    it('should reject decimal input exceeding 8 places', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))

      act(() => {
        result.current.handleInputAmount('1.123456789')
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should accept 0.xxx format', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))

      act(() => {
        result.current.handleInputAmount('0.5')
      })

      expect(result.current.inputValue).toBe('0.5')
    })

    it('should accept empty string', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, value: '100' })
      )

      act(() => {
        result.current.handleInputAmount('')
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should reject leading zeros for integers', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))

      act(() => {
        result.current.handleInputAmount('01')
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should handle event object input', () => {
      const { result } = renderHook(() => useAmountInputLogic(defaultProps))

      act(() => {
        result.current.handleInputAmount({ target: { value: '50' } })
      })

      expect(result.current.inputValue).toBe('50')
    })
  })

  describe('handleInputAmount - disableDecimal mode', () => {
    it('should accept valid integer input', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, disableDecimal: true })
      )

      act(() => {
        result.current.handleInputAmount('123')
      })

      expect(result.current.inputValue).toBe('123')
    })

    it('should reject decimal input', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, disableDecimal: true })
      )

      act(() => {
        result.current.handleInputAmount('1.5')
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should reject zero', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, disableDecimal: true })
      )

      act(() => {
        result.current.handleInputAmount('0')
      })

      expect(result.current.inputValue).toBe('')
    })
  })

  describe('handleInputAmount - BRC20 decimal mode (18 decimals)', () => {
    it('should accept up to 18 decimal places', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, enableBrc20Decimal: true })
      )

      act(() => {
        result.current.handleInputAmount('1.123456789012345678')
      })

      expect(result.current.inputValue).toBe('1.123456789012345678')
    })

    it('should reject more than 18 decimal places', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, enableBrc20Decimal: true })
      )

      act(() => {
        result.current.handleInputAmount('1.1234567890123456789')
      })

      expect(result.current.inputValue).toBe('')
    })
  })

  describe('handleInputAmount - custom runesDecimal', () => {
    it('should accept decimals up to runesDecimal places', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, runesDecimal: 4 })
      )

      act(() => {
        result.current.handleInputAmount('1.1234')
      })

      expect(result.current.inputValue).toBe('1.1234')
    })

    it('should reject decimals exceeding runesDecimal places', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, runesDecimal: 4 })
      )

      act(() => {
        result.current.handleInputAmount('1.12345')
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should handle runesDecimal of 0', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, runesDecimal: 0 })
      )

      act(() => {
        result.current.handleInputAmount('123')
      })

      expect(result.current.inputValue).toBe('123')

      act(() => {
        result.current.handleInputAmount('1.1')
      })

      // Should still be '123' since '1.1' is rejected
      expect(result.current.inputValue).toBe('123')
    })
  })

  describe('handleStepUp', () => {
    it('should increment value by step', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({
          ...defaultProps,
          value: '10',
          step: 1,
          runesDecimal: 2,
        })
      )

      act(() => {
        result.current.handleStepUp()
      })

      expect(result.current.inputValue).toBe('11.00')
    })

    it('should handle empty initial value', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({
          ...defaultProps,
          step: 5,
          runesDecimal: 2,
        })
      )

      act(() => {
        result.current.handleStepUp()
      })

      expect(result.current.inputValue).toBe('5.00')
    })
  })

  describe('handleStepDown', () => {
    it('should decrement value by step', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({
          ...defaultProps,
          value: '10',
          step: 1,
          min: 0,
          runesDecimal: 2,
        })
      )

      act(() => {
        result.current.handleStepDown()
      })

      expect(result.current.inputValue).toBe('9.00')
    })

    it('should not go below min value', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({
          ...defaultProps,
          value: '5',
          step: 10,
          min: 0,
          runesDecimal: 2,
        })
      )

      act(() => {
        result.current.handleStepDown()
      })

      expect(result.current.inputValue).toBe('0.00')
    })
  })

  describe('handleReset', () => {
    it('should reset input value to empty string', () => {
      const { result } = renderHook(() =>
        useAmountInputLogic({ ...defaultProps, value: '100' })
      )

      expect(result.current.inputValue).toBe('100')

      act(() => {
        result.current.handleReset()
      })

      expect(result.current.inputValue).toBe('')
    })
  })

  describe('value prop changes', () => {
    it('should update inputValue when value prop changes', () => {
      const { result, rerender } = renderHook(
        (props) => useAmountInputLogic(props),
        { initialProps: { ...defaultProps, value: '100' } }
      )

      expect(result.current.inputValue).toBe('100')

      rerender({ ...defaultProps, value: '200' })

      expect(result.current.inputValue).toBe('200')
    })
  })
})
