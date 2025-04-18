import { styled, DefaultTheme } from 'styled-components';
import { button } from '../utils/typography';
import { focusOutline, overlays, buttonBase } from '../utils/button';
import { Density } from '../types/Density';
import { useDensity } from '../hooks/useDensity';
import * as RadixRadioGroup from '@radix-ui/react-radio-group';
import { useDisabled } from '../hooks/useDisabled';
import { ToStringable } from '../utils/ToStringable';
import { useCallback, useEffect } from 'react';

const Root = styled.div`
  display: flex;
  gap: ${props => props.theme.spacing(2)};
`;

const Segment = styled.button<{
  $getFocusOutlineColor: (theme: DefaultTheme) => string;
  $getBorderRadius: (theme: DefaultTheme) => string;
  $selected: boolean;
  $density: Density;
}>`
  ${buttonBase}
  ${button}
  ${overlays}
  ${focusOutline}

  color:${props => props.theme.color.base.white};
  border: 1px solid
    ${props =>
      props.$selected ? props.theme.color.neutral.light : props.theme.color.other.tonalStroke};
  border-radius: ${props => props.theme.borderRadius.full};

  padding-top: ${props => props.theme.spacing(props.$density === 'sparse' ? 2 : 1)};
  padding-bottom: ${props => props.theme.spacing(props.$density === 'sparse' ? 2 : 1)};
  padding-left: ${props => props.theme.spacing(props.$density === 'sparse' ? 4 : 2)};
  padding-right: ${props => props.theme.spacing(props.$density === 'sparse' ? 4 : 2)};
`;

/**
 * Radix's `<RadioGroup />` component only accepts strings for its values, but
 * we don't want to enforce that in `<SegmentedControl />`. Instead, we allow
 * options to be passed whose values extend `ToStringable` (i.e., they have a
 * `.toString()` method). Then, when a specific option is selected and passed to
 * `onChange()`, we need to map from the string value back to the original value
 * passed in the options array.
 *
 * To make sure this works as expected, we need to assert that each option
 * value's `.toString()` method returns a unique value. That way, we can avoid a
 * situation where, e.g., all the options' values return `[object Object]`, and
 * the wrong object is passed to `onChange`.
 */
const assertUniqueOptions = (options: Option<ToStringable>[]) => {
  const existingOptions = new Set<string>();

  options.forEach(option => {
    if (existingOptions.has(option.value.toString())) {
      throw new Error(
        'The value options passed to `<SegmentedControl />` are not unique. Please check that the result of calling `.toString()` on each of the options passed to `<SegmentedControl />` is unique.',
      );
    }

    existingOptions.add(option.value.toString());
  });
};

export interface Option<ValueType extends ToStringable> {
  value: ValueType;
  label: string;
  /** Whether this individual option should be disabled. */
  disabled?: boolean;
}

export interface SegmentedControlProps<ValueType extends ToStringable> {
  value: ValueType;
  onChange: (value: ValueType) => void;
  options: Option<ValueType>[];
  /**
   * Whether this entire control should be disabled. Note that single options
   * can be disabled individually by setting the `disabled` property for that
   * given option.
   */
  disabled?: boolean;
}

/**
 * Renders a segmented control where only one option can be selected at a time.
 * Functionally equivalent to a `<select>` element or a set of radio buttons,
 * but looks nicer when you only have a few options to choose from. (Probably
 * shouldn't be used with more than 5 options.)
 *
 * Fully accessible and keyboard-controllable.
 *
 * @example
 * ```TSX
 * <SegmentedPicker
 *   value={value}
 *   onChange={setValue}
 *   options={[
 *     { value: 'one', label: 'One' },
 *     { value: 'two', label: 'Two' },
 *     { value: 'three', label: 'Three', disabled: true },
 *   ]}
 * />
 * ```
 */
export const SegmentedControl = <ValueType extends ToStringable>({
  value,
  onChange,
  options,
  disabled,
}: SegmentedControlProps<ValueType>) => {
  const density = useDensity();
  const isDisabled = useDisabled(disabled);
  useEffect(() => assertUniqueOptions(options), [options]);

  const handleChange = useCallback(
    (optionValue: string) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- TODO: justify non-null assertion
      const selected = options.find(option => option.value.toString() === optionValue)!;
      onChange(selected.value);
    },
    [options, onChange],
  );

  return (
    <RadixRadioGroup.Root asChild value={value.toString()} onValueChange={handleChange}>
      <Root>
        {options.map(option => (
          <RadixRadioGroup.Item
            asChild
            key={option.value.toString()}
            value={option.value.toString()}
          >
            <Segment
              onClick={() => onChange(option.value)}
              $getBorderRadius={theme => theme.borderRadius.full}
              $getFocusOutlineColor={theme => theme.color.neutral.light}
              $selected={value === option.value}
              $density={density}
              disabled={isDisabled || option.disabled}
            >
              {option.label}
            </Segment>
          </RadixRadioGroup.Item>
        ))}
      </Root>
    </RadixRadioGroup.Root>
  );
};
