import type { IntentType } from '../types';

const INTENTS: IntentType[] = ['conversational', 'task', 'emotional'];

interface Props {
  value: IntentType;
  onChange: (intent: IntentType) => void;
  disabled?: boolean;
}

export function IntentSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="panel intent-selector">
      <h3>Intent Type</h3>
      <div className="intent-buttons">
        {INTENTS.map((intent) => (
          <button
            key={intent}
            className={value === intent ? 'active' : ''}
            onClick={() => onChange(intent)}
            disabled={disabled}
          >
            {intent}
          </button>
        ))}
      </div>
    </div>
  );
}
