/** 指で操作する端末か（スマホ・タブレット）。当たり判定の幅や案内の文言を変えるのに使う */
export const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
