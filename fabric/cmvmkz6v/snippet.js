import { EventEmitter } from 'events';

/**
 * LoadBalancer — מנהל חלוקת עומסים מאוזן למנוע עיבוד מקבילי
 * 
 * יישום אלגוריתם round-robin משופר עם:
 * - ניטור זמן-המתנה אמיתי והקצאה דינמית
 * - מערכת ניטור מתעדכנת כל 30 שניות
 * - העדפת צמתים פחות עמוסים כאשר זמן המתנה > 200ms
 * 
 * משתמש ב-EventEmitter לניהול אירועי מערכת
 */
export class LoadBalancer extends EventEmitter {
  /**
   * @param {Array<Object>} nodes - מערך צמתים עם פרטי התחברות
   * @param {number} [updateInterval=30000] - זמן עדכון מערכת הניטור (במילישניות)
   */
  constructor(nodes, updateInterval = 30000) {
    super();
    
    // אימוץ צמתים עם מצב התחלתי
    this.nodes = nodes.map(node => ({
      ...node,
      currentLoad: 0,
      averageWaitTime: 0,
      isHealthy: true,
      lastUsed: 0
    }));
    
    // אינדקס round-robin
    this.roundRobinIndex = 0;
    
    // זמן עדכון הניטור
    this.updateInterval = updateInterval;
    
    // הפעלת מערכת הניטור
    this.startMonitoring();
  }
  
  /**
   * מקבל צומת זמין לפי אלגוריתם החלוקה
   * @returns {Object|null} הצומת הנבחר או null אם אין צמתים זמינים
   */
  getNode() {
    // אם אין צמתים זמינים, חזור null
    const availableNodes = this.nodes.filter(node => node.isHealthy);
    if (availableNodes.length === 0) {
      this.emit('error', 'No available nodes');
      return null;
    }
    
    // בדיקה אם יש צומת עם זמן המתנה גבוה
    const overloadedNodes = availableNodes.filter(
      node => node.averageWaitTime > 200
    );
    
    let selectedNode;
    
    if (overloadedNodes.length > 0) {
      // אם יש צמתים עם זמן המתנה גבוה, בחר את הצומת הפחות עמוס
      selectedNode = overloadedNodes.reduce((prev, current) => 
        (prev.currentLoad < current.currentLoad) ? prev : current
      );
      
      this.emit('loadBalanced', {
        reason: 'highWaitTime',
        selectedNode: selectedNode.id,
        waitTime: selectedNode.averageWaitTime,
        load: selectedNode.currentLoad
      });
    } else {
      // ברובין רגיל על כל הצמתים הזמינים
      selectedNode = availableNodes[this.roundRobinIndex % availableNodes.length];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % availableNodes.length;
      
      this.emit('loadBalanced', {
        reason: 'roundRobin',
        selectedNode: selectedNode.id,
        waitTime: selectedNode.averageWaitTime,
        load: selectedNode.currentLoad
      });
    }
    
    // עדכון זמן השימוש האחרון
    selectedNode.lastUsed = Date.now();
    
    return selectedNode;
  }
  
  /**
   * מעדכן את נתוני העומס של צומת
   * @param {string} nodeId - מזהה הצומת
   * @param {number} load - רמת העומס החדשה
   * @param {number} waitTime - זמן המתנה ממוצע
   */
  updateNodeLoad(nodeId, load, waitTime) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.currentLoad = load;
      node.averageWaitTime = waitTime;
      
      this.emit('nodeUpdated', {
        nodeId,
        load,
        waitTime
      });
    }
  }
  
  /**
   * מסמן צומת כלא זמין
   * @param {string} nodeId - מזהה הצומת
   */
  markNodeDown(nodeId) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.isHealthy = false;
      
      this.emit('nodeDown', {
        nodeId,
        message: 'Node marked as unhealthy'
      });
    }
  }
  
  /**
   * מסמן צומת כזמין מחדש
   * @param {string} nodeId - מזהה הצומת
   */
  markNodeUp(nodeId) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.isHealthy = true;
      
      this.emit('nodeUp', {
        nodeId,
        message: 'Node marked as healthy'
      });
    }
  }
  
  /**
   * מפעיל מערכת ניטור שמתעדכנת כל 30 שניות
   */
  startMonitoring() {
    // קודם כל, נריץ עדכון מיד
    this.performSystemCheck();
    
    // הגדרת טיימר לעדכון קבוע
    this.monitoringInterval = setInterval(() => {
      this.performSystemCheck();
    }, this.updateInterval);
    
    this.emit('monitoringStarted', {
      interval: this.updateInterval
    });
  }
  
  /**
   * מבצע בדיקת מערכת שלמה
   */
  performSystemCheck() {
    // ניתוח כללי של המערכת
    const totalNodes = this.nodes.length;
    const healthyNodes = this.nodes.filter(n => n.isHealthy).length;
    const averageSystemLoad = this.nodes.reduce(
      (sum, node) => sum + node.currentLoad, 0
    ) / totalNodes;
    
    const averageWaitTime = this.nodes.reduce(
      (sum, node) => sum + node.averageWaitTime, 0
    ) / totalNodes;
    
    // זיהוי צמתים עם עומס גבוה
    const highLoadNodes = this.nodes.filter(
      node => node.currentLoad > 80 && node.isHealthy
    );
    
    // זיהוי צמתים עם זמן המתנה גבוה
    const highWaitNodes = this.nodes.filter(
      node => node.averageWaitTime > 200 && node.isHealthy
    );
    
    // שליחת נתוני הניטור
    this.emit('systemCheck', {
      timestamp: Date.now(),
      totalNodes,
      healthyNodes,
      averageSystemLoad,
      averageWaitTime,
      highLoadNodes: highLoadNodes.length,
      highWaitNodes: highWaitNodes.length
    });
    
    // אם יש צמתים עם זמן המתנה גבוה, נשלח התראה
    if (highWaitNodes.length > 0) {
      this.emit('highWaitTimeAlert', {
        nodes: highWaitNodes.map(n => ({
          id: n.id,
          waitTime: n.averageWaitTime,
          load: n.currentLoad
        }))
      });
    }
  }
  
  /**
   * מפסיק את מערכת הניטור
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      
      this.emit('monitoringStopped');
    }
  }
  
  /**
   * מציג את מצב המערכת הנוכחי
   * @returns {Object} נתוני מצב המערכת
   */
  getSystemStatus() {
    return {
      nodes: this.nodes.map(node => ({
        id: node.id,
        load: node.currentLoad,
        waitTime: node.averageWaitTime,
        isHealthy: node.isHealthy,
        lastUsed: node.lastUsed
      })),
      roundRobinIndex: this.roundRobinIndex,
      updateInterval: this.updateInterval
    };
  }
}

/**
 * פונקציית עזר ליצירת מופע LoadBalancer
 * @param {Array<Object>} nodes - מערך צמתים
 * @param {number} [updateInterval=30000] - זמן עדכון הניטור
 * @returns {LoadBalancer} מופע חדש של LoadBalancer
 */
export function createLoadBalancer(nodes, updateInterval = 30000) {
  return new LoadBalancer(nodes, updateInterval);
}
