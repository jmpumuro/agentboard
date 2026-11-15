import { useContext } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { ThemeContext } from './theme';
export function ThemeControl() {
    const [preference, choose] = useContext(ThemeContext);
    return <fieldset className="theme-control">
        <legend>Appearance</legend>
        <div className="theme-options">
            {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([value, label, Icon]) => <label key={value} className={'theme-option ' + (preference === value ? 'selected' : '')}>
                    <input type="radio" name="appearance" value={value} checked={preference === value} onChange={() => choose(value)}/>
                    <Icon size={17} aria-hidden="true"/><span>{label}</span>
                </label>)}
        </div>
        <p>Choose a theme for this browser. System follows your device’s appearance.</p>
    </fieldset>;
}
