/**
 * 这是一个简单的计数器初始化函数（Vite 默认模板自带）
 * @param element 触发计数的 HTML 按钮元素
 */
export function setupCounter(element: HTMLButtonElement) {
  let counter = 0
  const setCounter = (count: number) => {
    counter = count
    element.innerHTML = `Count is ${counter}`
  }
  element.addEventListener('click', () => setCounter(counter + 1))
  setCounter(0)
}
