/**
 * 「拍照存东西」的统一入口。
 *
 * 全 App 有三个地方能开始拍照：
 *   - 底部导航的「＋」
 *   - 搜索页空状态里的「拍一张存起来」
 *   - 首页搜索框旁边的入口
 *
 * 它们以前各写一遍「开相机 → 跳入库页」，结果三处的行为不一致：
 * 有的会先定位置，有的不定。用户在不同入口得到的流程不一样，很别扭。
 *
 * 现在统一收在这里：先定位置 → 开相机 → 进入库页。
 * 位置在拍照前就定了，拍完直接归位。
 *
 * 【为什么要用回调而不是 Promise】
 * 浏览器只在「同一次用户手势」里才允许弹相机。
 * 如果选完位置用 Promise.then() 再开相机，就已经脱离了这次点击的手势上下文，
 * 部分手机浏览器会直接拒绝。所以整条链都用回调，保证开相机发生在点击的同一个调用栈。
 */

import { openCamera } from './camera.js';
import { pickDestination } from './destination.js';
import { navigate } from '../router.js';

/**
 * @param {object} [opts]
 * @param {number|null} [opts.containerId] 已经确定的位置（从盒子详情进来时用），跳过选择步骤
 * @param {string} [opts.returnTo] 拍完之后跳哪里（默认进 /inbound）
 */
export function startPhotoFlow({ containerId = null, returnTo = '/inbound' } = {}) {
  // 已经有位置了（从盒子详情点「往这里放」进来）—— 直接开相机
  if (containerId) {
    openCamera({
      onDone: (files) => {
        if (files?.length) navigate(`${returnTo}?containerId=${containerId}`);
      },
    });
    return;
  }

  pickDestination((dest) => {
    if (!dest) return; // 用户取消
    if (dest.containerId) {
      try {
        sessionStorage.setItem('preferredContainerId', String(dest.containerId));
      } catch {
        /* 存不了也不影响 */
      }
    }
    openCamera({
      onDone: (files) => {
        if (files?.length) navigate(returnTo);
      },
    });
  });
}
