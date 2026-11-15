/**
 * [0.13.3] 统计页的应用图标：真图标优先，取不到就画首字瓦片。
 *
 * 为什么不用 `convertFileSrc` + asset 协议：图标是桥回的 data URI（见
 * `gen/android/…/native/AppMetadata.kt` 的注释），一个字段就够，不需要文件路径、
 * 不需要作用域配置，也就没有「配错了满屏空白」这条只在真机上才看得见的失败路径。
 *
 * 为什么必须有瓦片兜底：包已卸载、取图标失败、图标压不出来，都会让 `icon` 为空串。
 * 那时**不许留一个破图或一个空格子** —— 首字瓦片至少还能和名字对上。
 */
interface Props {
  /** 已经解析好的显示名（真名，或包名短名）；只用它的首字做瓦片 */
  label: string;
  /** `data:image/webp;base64,…`；空串 / undefined = 没有图标 */
  icon?: string;
}

export function UsageAppIcon({ label, icon }: Props) {
  if (icon != null && icon !== '') {
    /* `alt=""` + `aria-hidden`：名字就在旁边的文本里，读屏再念一遍图标是噪音。 */
    return <img className="m-usage__icon" src={icon} alt="" aria-hidden="true" />;
  }
  const initial = label.trim().slice(0, 1);
  return (
    <span className="m-usage__icon m-usage__icon--letter" aria-hidden="true">
      {initial === '' ? '·' : initial}
    </span>
  );
}
